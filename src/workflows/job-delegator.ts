import type { Id } from "../domain/id.ts";
import type { Job, JobType } from "../domain/job.ts";
import { capabilityForPurpose } from "../domain/execution-profile.ts";
import type { WorkerSession } from "../domain/worker-session.ts";
import { GitRepository } from "../infrastructure/git/git-repository.ts";
import { HarnessSetup } from "../infrastructure/process/harness-setup.ts";
import { DetachedRunnerLauncher } from "../infrastructure/process/detached-runner-launcher.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { JobWorktreeLocator } from "./job-worktree-locator.ts";
import { WorkflowProfileLoader } from "./workflow-profiles.ts";

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

export interface DelegatedJob {
  job: Job;
  workerSession: WorkerSession;
  worktreePath: string | null;
  pid: number;
}

interface Worktrees { create(workspaceRoot: string, worktreePath: string): void; }

/** Resolves policy and trusted capability, preflights, then persists and launches one job. */
export class JobDelegator {
  constructor(
    private readonly root: string,
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly ids: Pick<Id, "createJobId" | "createWorkerSessionId">,
    private readonly runner: DetachedRunnerLauncher,
    private readonly worktrees: Worktrees,
    private readonly clock: Clock,
    private readonly profiles: WorkflowProfileLoader = WorkflowProfileLoader.createNull(TEST_POLICY),
    private readonly setup: HarnessSetup = HarnessSetup.createNull(),
  ) {}

  static create(root: string, registry: Registry, taskStore: TaskStore, ids: Pick<Id, "createJobId" | "createWorkerSessionId">, runner: DetachedRunnerLauncher): JobDelegator {
    return new JobDelegator(
      root, registry, taskStore, ids, runner,
      { create: (workspaceRoot, worktreePath) => GitRepository.create(workspaceRoot).createWorktree(worktreePath) },
      Clock.create(), WorkflowProfileLoader.create(root), HarnessSetup.create(),
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

    const policy = this.profiles.load();
    const overrides = parseOverrides(task.profileOverrides);
    const profileName = overrides[input.jobType] ?? policy.defaults[input.jobType];
    if (!profileName) throw new Error(`WORKFLOW.md has no default worker profile for purpose: ${input.jobType}`);
    const profile = policy.profiles[profileName];
    if (!profile) throw new Error(`Task override references unavailable worker profile: ${profileName}`);
    const capability = capabilityForPurpose(input.jobType);
    // Every executable identity and environment contract is resolved before persistence.
    const preparedRunner = this.runner.preflight();
    const prepared = this.setup.verify(profile, capability, workspace.rootDir);

    const jobId = this.ids.createJobId();
    const workerSessionId = this.ids.createWorkerSessionId();
    const timestamp = this.clock.now();
    const worktreePath = input.jobType === "implement"
      ? this.taskStore.paths.worktree(jobId)
      : dependency ? new JobWorktreeLocator(this.registry, this.taskStore).locate(dependency) : null;
    if (["review", "fix", "test"].includes(input.jobType) && !worktreePath) throw new Error(`A ${input.jobType} job requires a dependency with an implementation worktree`);
    if (input.jobType === "implement" && worktreePath) this.worktrees.create(workspace.rootDir, worktreePath);

    const bundlePath = await this.taskStore.jobs.create({ taskId: task.id, jobId, request: input.request });
    const eventLog = this.taskStore.events(task.id, jobId, workerSessionId);
    await eventLog.create();
    const job: Job = {
      id: jobId, taskId: task.id, jobType: input.jobType,
      parentSessionId: input.parentSessionId, parentSessionFile: input.parentSessionFile,
      snapshotProvenance: "current",
      workerProfile: profile.name, profileFingerprint: profile.fingerprint,
      capabilityProfile: capability, harness: profile.harness,
      harnessVersion: prepared.version, nativeInvocation: JSON.stringify(prepared.invocation),
      model: profile.model, effortLevel: profile.options.thinking ?? "",
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
      // SQLite settlement is mandatory and always precedes the best-effort event projection.
      try {
        this.registry.transaction(() => {
          this.registry.jobs.updateStatus(job.id, "failed", detail, finishedAt);
          this.registry.tasks.updateStatus(task.id, "failed", finishedAt);
        });
      } catch (settlementError) {
        persistenceFailure = settlementError;
      }
      try {
        await eventLog.append({ timestamp: finishedAt, type: "error", error: detail });
      } catch (appendError) {
        eventFailure = appendError;
      }
      const secondary = [
        persistenceFailure && `state settlement failed: ${errorText(persistenceFailure)}`,
        eventFailure && `canonical error append failed: ${errorText(eventFailure)}`,
      ].filter(Boolean).join("; ");
      throw new Error(secondary ? `${detail}; ${secondary}` : detail, { cause: error });
    }
  }
}

const TEST_POLICY = `\n\`\`\`yaml\nprofiles:\n  pi-test:\n    harness: pi\n    model: openai-codex/gpt-5.6-sol\n    thinking: high\ndefaults:\n  plan: pi-test\n  implement: pi-test\n  review: pi-test\n\`\`\`\n`;

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function parseOverrides(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Task worker profile overrides are corrupt"); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Task worker profile overrides are corrupt");
  for (const [key, item] of Object.entries(parsed)) if (!key || typeof item !== "string") throw new Error("Task worker profile overrides are corrupt");
  return parsed as Record<string, string>;
}
