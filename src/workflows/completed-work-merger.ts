import type { Job } from "../domain/job.ts";
import { GitRepository } from "../infrastructure/git/git-repository.ts";
import { Registry, type NullRegistryState } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";

interface MergeRepository {
  status(): string;
  head(): string;
  changedFiles(): string[];
  diff(): string;
  commitAll(message: string): string;
  cherryPick(commit: string): void;
  abortCherryPick(): void;
}

interface MergeRepositories {
  open(root: string): MergeRepository;
}

export interface CompletedWorkInspection {
  taskId: string;
  jobId: string;
  workspaceName: string;
  workspaceRoot: string;
  worktreePath: string;
  changedFiles: string[];
  diff: string;
}

export interface CompletedWorkMerge extends CompletedWorkInspection {
  commit: string;
}

export interface NullCompletedWorkMergerState {
  registry?: NullRegistryState;
  sourceStatus?: string;
  sourceDiff?: string;
  sourceHead?: string;
  destinationStatus?: string;
  destinationHead?: string;
  commit?: string;
  mergedCommits?: string[];
  abortedCommits?: string[];
}

/** Merges one completed implementation worktree into its authorized workspace. */
export class CompletedWorkMerger {
  constructor(
    private readonly registry: Registry,
    private readonly worktreeForJob: (jobId: string) => string,
    private readonly repositories: MergeRepositories,
  ) {}

  static create(registry: Registry, taskStore: TaskStore): CompletedWorkMerger {
    return new CompletedWorkMerger(
      registry,
      (jobId) => taskStore.paths.worktree(jobId),
      { open: (root) => GitRepository.create(root) },
    );
  }

  static createNull(state: NullCompletedWorkMergerState = {}): CompletedWorkMerger {
    const sourceRoot = "/null-worker-agent/worktrees/job_implement";
    const sourceHead = state.sourceHead ?? "a".repeat(40);
    let destinationHead = state.destinationHead ?? sourceHead;
    const source: MergeRepository = {
      status: () => state.sourceStatus ?? "?? cursor-canary/",
      head: () => sourceHead,
      changedFiles: () => ["cursor-canary/index.ts", "cursor-canary/index.test.ts"],
      diff: () => state.sourceDiff ?? "diff --git a/cursor-canary/index.ts b/cursor-canary/index.ts",
      commitAll: () => state.commit ?? "b".repeat(40),
      cherryPick: () => {},
      abortCherryPick: () => {},
    };
    const destination: MergeRepository = {
      status: () => state.destinationStatus ?? "",
      head: () => destinationHead,
      changedFiles: () => [],
      diff: () => "",
      commitAll: () => "",
      cherryPick: (commit) => {
        state.mergedCommits?.push(commit);
        destinationHead = commit;
      },
      abortCherryPick: () => { state.abortedCommits?.push("aborted"); },
    };
    return new CompletedWorkMerger(
      Registry.createNull(state.registry),
      () => sourceRoot,
      { open: (root) => root === sourceRoot ? source : destination },
    );
  }

  inspect(jobId: string): CompletedWorkInspection {
    const context = this.context(jobId);
    return {
      taskId: context.job.taskId,
      jobId: context.job.id,
      workspaceName: context.workspace.name,
      workspaceRoot: context.workspace.rootDir,
      worktreePath: context.worktreePath,
      changedFiles: context.source.changedFiles(),
      diff: context.source.diff(),
    };
  }

  merge(jobId: string): CompletedWorkMerge {
    const context = this.context(jobId);
    const destinationStatus = context.destination.status();
    if (destinationStatus) throw new Error(`Workspace has uncommitted changes: ${context.workspace.rootDir}`);
    const sourceStatus = context.source.status();
    if (!sourceStatus) throw new Error(`Implementation worktree has no changes: ${context.worktreePath}`);
    if (context.source.head() !== context.destination.head()) {
      throw new Error("Workspace HEAD has changed since the implementation worktree was created");
    }

    const inspection = this.inspect(jobId);
    const sourceCommit = context.source.commitAll([
      context.job.title,
      "",
      `Task: ${context.job.taskId}`,
      `Job: ${context.job.id}`,
    ].join("\n"));
    try {
      context.destination.cherryPick(sourceCommit);
    } catch (error) {
      try { context.destination.abortCherryPick(); } catch { /* preserve the merge failure */ }
      throw error;
    }
    return { ...inspection, commit: context.destination.head() };
  }

  private context(jobId: string): {
    job: Job;
    workspace: { id: string; name: string; rootDir: string };
    worktreePath: string;
    source: MergeRepository;
    destination: MergeRepository;
  } {
    const job = this.registry.jobs.get(jobId);
    if (!job) throw new Error(`Unknown job: ${jobId}`);
    if (job.jobType !== "implement") throw new Error(`Job is not an implementation: ${job.id}`);
    if (job.status !== "completed") throw new Error(`Implementation job is not completed: ${job.id}`);
    const task = this.registry.tasks.get(job.taskId);
    if (!task?.workspaceId) throw new Error(`Task has no registered workspace: ${job.taskId}`);
    const workspace = this.registry.workspaces.get(task.workspaceId);
    if (!workspace?.authorizedAt) throw new Error(`Task workspace is not authorized: ${task.workspaceId}`);
    const worktreePath = this.worktreeForJob(job.id);
    return {
      job,
      workspace,
      worktreePath,
      source: this.repositories.open(worktreePath),
      destination: this.repositories.open(workspace.rootDir),
    };
  }
}
