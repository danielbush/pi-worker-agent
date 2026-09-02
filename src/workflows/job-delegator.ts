import type { Id } from "../domain/id.ts";
import type { Job, JobType } from "../domain/job.ts";
import type { WorkerSession } from "../domain/worker-session.ts";
import { GitRepository } from "../infrastructure/git/git-repository.ts";
import { DetachedRunnerLauncher } from "../infrastructure/process/detached-runner-launcher.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";

export interface DelegateJobInput {
  taskId: string;
  jobType: JobType;
  title: string;
  request: string;
  dependsOnJobId?: string;
  relationship?: string;
  parentSessionId: string;
  parentSessionFile: string | null;
  model: string;
  modelName: string;
  modelVersion: string;
  effortLevel: string;
}

export interface DelegatedJob {
  job: Job;
  workerSession: WorkerSession;
  worktreePath: string | null;
  pid: number;
}

interface Worktrees {
  create(workspaceRoot: string, worktreePath: string): void;
}

/** INFRASTRUCTURE_CONSUMER: persists and launches one manager-selected job. */
export class JobDelegator {
  constructor(
    private readonly root: string,
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly ids: Pick<Id, "createJobId" | "createWorkerSessionId">,
    private readonly runner: DetachedRunnerLauncher,
    private readonly worktrees: Worktrees,
    private readonly clock: Clock,
  ) {}

  static create(
    root: string,
    registry: Registry,
    taskStore: TaskStore,
    ids: Pick<Id, "createJobId" | "createWorkerSessionId">,
    runner: DetachedRunnerLauncher,
  ): JobDelegator {
    return new JobDelegator(
      root,
      registry,
      taskStore,
      ids,
      runner,
      { create: (workspaceRoot, worktreePath) => GitRepository.create(workspaceRoot).createWorktree(worktreePath) },
      Clock.create(),
    );
  }

  async delegate(input: DelegateJobInput): Promise<DelegatedJob> {
    if (input.jobType !== "plan" && input.jobType !== "implement") {
      throw new Error(`Unsupported job type in this slice: ${input.jobType}`);
    }
    const task = this.registry.tasks.get(input.taskId);
    if (!task) throw new Error(`Unknown task: ${input.taskId}`);
    const workspace = task.workspaceId ? this.registry.workspaces.get(task.workspaceId) : undefined;
    if (!workspace) throw new Error(`Task has no registered workspace: ${task.id}`);

    const dependency = input.dependsOnJobId
      ? this.registry.jobs.get(input.dependsOnJobId)
      : undefined;
    if (input.dependsOnJobId && (!dependency || dependency.taskId !== task.id)) {
      throw new Error(`Dependency does not belong to task: ${input.dependsOnJobId}`);
    }
    if (dependency && dependency.status !== "completed") {
      throw new Error(`Dependency is not completed: ${dependency.id}`);
    }
    if (dependency && !input.relationship) {
      throw new Error("A dependency relationship is required");
    }

    const jobId = this.ids.createJobId();
    const workerSessionId = this.ids.createWorkerSessionId();
    const timestamp = this.clock.now();
    const worktreePath = input.jobType === "implement"
      ? this.taskStore.paths.worktree(jobId)
      : null;
    if (worktreePath) this.worktrees.create(workspace.rootDir, worktreePath);

    const bundlePath = await this.taskStore.jobs.create({
      taskId: task.id,
      jobId,
      request: input.request,
    });
    const eventLog = this.taskStore.events(task.id, jobId, workerSessionId);
    await eventLog.create();

    const job: Job = {
      id: jobId,
      taskId: task.id,
      jobType: input.jobType,
      parentSessionId: input.parentSessionId,
      parentSessionFile: input.parentSessionFile,
      harness: "pi",
      model: input.model,
      effortLevel: input.effortLevel,
      modelName: input.modelName,
      modelVersion: input.modelVersion,
      title: input.title,
      status: "queued",
      progress: "Waiting to start Pi worker",
      createdAt: timestamp,
      finishedAt: null,
      bundlePath,
      userNotified: false,
      agentNotified: false,
    };
    const workerSession: WorkerSession = {
      id: workerSessionId,
      jobId,
      harnessSessionId: null,
      harnessSessionPath: null,
      storagePath: this.taskStore.paths.workerSession(task.id, jobId, workerSessionId),
      createdAt: timestamp,
    };

    this.registry.transaction(() => {
      this.registry.tasks.updateStatus(task.id, "queued");
      this.registry.jobs.create(job);
      if (dependency) {
        this.registry.jobDependencies.create({
          jobId,
          dependsOnJobId: dependency.id,
          relationship: input.relationship!,
        });
      }
      this.registry.workerSessions.create(workerSession);
    });

    const pid = this.runner.launch(this.root, task.id, job.id, workerSession.id);
    return { job, workerSession, worktreePath, pid };
  }
}
