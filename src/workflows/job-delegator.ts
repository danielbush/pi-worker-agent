import { executableAgentProfile } from "../domain/agent-profile.ts";
import type { Id } from "../domain/id.ts";
import type { Job, JobType } from "../domain/job.ts";
import type { WorkerSession } from "../domain/worker-session.ts";
import { GitRepository } from "../infrastructure/git/git-repository.ts";
import { DetachedRunnerLauncher } from "../infrastructure/process/detached-runner-launcher.ts";
import { HarnessSetup } from "../infrastructure/process/harness-setup.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { JobWorktreeLocator } from "./job-worktree-locator.ts";

export interface DelegateJobInput {
  taskId: string;
  jobType: JobType;
  title: string;
  request: string;
  dependsOnJobId?: string;
  relationship?: string;
  parentSessionId: string;
  parentSessionFile: string | null;
}
export interface DelegatedJob { job: Job; workerSession: WorkerSession; worktreePath: string | null; pid: number; }
interface Worktrees { create(workspaceRoot: string, worktreePath: string): void; }

/** Resolves catalog configuration, preflights, persists, and launches one job. */
export class JobDelegator {
  constructor(
    private readonly root: string,
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly ids: Pick<Id, "createJobId" | "createWorkerSessionId">,
    private readonly runner: DetachedRunnerLauncher,
    private readonly worktrees: Worktrees,
    private readonly clock: Clock,
    private readonly setup: HarnessSetup = HarnessSetup.createNull(),
  ) {}

  static create(root: string, registry: Registry, taskStore: TaskStore, ids: Pick<Id, "createJobId" | "createWorkerSessionId">, runner: DetachedRunnerLauncher): JobDelegator {
    return new JobDelegator(
      root, registry, taskStore, ids, runner,
      { create: (workspaceRoot, worktreePath) => GitRepository.create(workspaceRoot).createWorktree(worktreePath) },
      Clock.create(), HarnessSetup.create(),
    );
  }

  async delegate(input: DelegateJobInput): Promise<DelegatedJob> {
    const task = this.registry.tasks.get(input.taskId);
    if (!task) throw new Error(`Unknown task: ${input.taskId}`);
    const workspace = task.workspaceId ? this.registry.workspaces.get(task.workspaceId) : undefined;
    if (!workspace) throw new Error(`Task has no registered workspace: ${task.id}`);
    const dependency = input.dependsOnJobId ? this.registry.jobs.get(input.dependsOnJobId) : undefined;
    if (input.dependsOnJobId && (!dependency || dependency.taskId !== task.id)) throw new Error(`Dependency does not belong to task: ${input.dependsOnJobId}`);
    if (dependency && dependency.status !== "completed") throw new Error(`Dependency is not completed: ${dependency.id}`);
    if (dependency && !input.relationship) throw new Error("A dependency relationship is required");

    const jobType = this.registry.jobTypes.get(input.jobType);
    if (!jobType || jobType.retired) throw new Error(`Unknown or retired job type: ${input.jobType}`);
    const override = this.registry.taskAgentProfileOverrides.get(task.id, jobType.id);
    const agentProfileId = override?.agentProfileId ?? jobType.defaultAgentProfileId;
    const storedProfile = this.registry.agentProfiles.get(agentProfileId);
    if (!storedProfile || storedProfile.retired) throw new Error(`Selected agent profile is unknown or retired: ${agentProfileId}`);
    const profile = executableAgentProfile(storedProfile);
    const selectionSource = override ? "task-override" as const : "job-type-default" as const;

    const preparedRunner = this.runner.preflight();
    const jobId = this.ids.createJobId();
    const workerSessionId = this.ids.createWorkerSessionId();
    const timestamp = this.clock.now();
    const worktreePath = jobType.worktreeStrategy === "new-worktree"
      ? this.taskStore.paths.worktree(jobId)
      : jobType.worktreeStrategy === "dependency-worktree" && dependency
        ? new JobWorktreeLocator(this.registry, this.taskStore).locate(dependency)
        : null;
    if (jobType.worktreeStrategy === "dependency-worktree" && !worktreePath) {
      throw new Error(`Job type ${jobType.id} requires a dependency with an implementation worktree`);
    }
    const executionPath = worktreePath ?? workspace.rootDir;
    const prepared = this.setup.verify(profile, jobType.capabilityProfile, workspace.rootDir, executionPath);
    if (jobType.worktreeStrategy === "new-worktree" && worktreePath) this.worktrees.create(workspace.rootDir, worktreePath);

    const bundlePath = await this.taskStore.jobs.create({ taskId: task.id, jobId, request: input.request });
    const eventLog = this.taskStore.events(task.id, jobId, workerSessionId);
    await eventLog.create();
    const job: Job = {
      id: jobId, taskId: task.id, jobTypeId: jobType.id,
      agentProfileId: storedProfile.id, agentProfileSelectionSource: selectionSource,
      parentSessionId: input.parentSessionId, parentSessionFile: input.parentSessionFile,
      snapshotProvenance: "current", profileFingerprint: profile.fingerprint,
      profileOptions: JSON.stringify(profile.options), capabilityProfile: jobType.capabilityProfile,
      harness: profile.harness, harnessVersion: prepared.version, nativeInvocation: JSON.stringify(prepared.invocation),
      model: profile.model, effortLevel: profile.options.thinking ?? profile.options.effort ?? "",
      modelName: profile.model, modelVersion: profile.model,
      title: input.title, status: "queued", progress: `Waiting to start ${profile.harness} worker`,
      createdAt: timestamp, finishedAt: null, bundlePath, userNotified: false, agentNotified: false,
    };
    const workerSession: WorkerSession = {
      id: workerSessionId, jobId, harnessSessionId: null, harnessSessionPath: null,
      storagePath: this.taskStore.paths.workerSession(task.id, jobId, workerSessionId), createdAt: timestamp,
    };
    this.registry.transaction(() => {
      this.registry.tasks.updateStatus(task.id, "queued");
      this.registry.jobs.create(job);
      if (dependency) this.registry.jobDependencies.create({ jobId, dependsOnJobId: dependency.id, relationship: input.relationship! });
      this.registry.workerSessions.create(workerSession);
    });
    try {
      const pid = this.runner.launch(preparedRunner, this.root, task.id, job.id, workerSession.id);
      return { job, workerSession, worktreePath, pid };
    } catch (error) {
      const detail = `Detached runner launch failed: ${error instanceof Error ? error.message : String(error)}`;
      const finishedAt = this.clock.now();
      let persistenceFailure: unknown;
      let eventFailure: unknown;
      try {
        this.registry.transaction(() => {
          this.registry.jobs.updateStatus(job.id, "failed", detail, finishedAt);
          this.registry.tasks.updateStatus(task.id, "failed", finishedAt);
        });
      } catch (settlementError) { persistenceFailure = settlementError; }
      try { await eventLog.append({ timestamp: finishedAt, type: "error", error: detail }); }
      catch (appendError) { eventFailure = appendError; }
      const secondary = [
        persistenceFailure && `state settlement failed: ${errorText(persistenceFailure)}`,
        eventFailure && `canonical error append failed: ${errorText(eventFailure)}`,
      ].filter(Boolean).join("; ");
      throw new Error(secondary ? `${detail}; ${secondary}` : detail, { cause: error });
    }
  }
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
