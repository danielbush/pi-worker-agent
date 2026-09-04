import type { Job } from "../domain/job.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";

/** Locates a worktree owned by a job or inherited through its dependency chain. */
export class JobWorktreeLocator {
  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
  ) {}

  locate(job: Job): string | null {
    return this.locateFrom(job, new Set());
  }

  private locateFrom(job: Job, visited: Set<string>): string | null {
    const jobType = this.registry.jobTypes.get(job.jobTypeId);
    if (!jobType) throw new Error(`Unknown job type for job ${job.id}: ${job.jobTypeId}`);
    if (jobType.worktreeStrategy === "new-worktree") return this.taskStore.paths.worktree(job.id);
    if (visited.has(job.id)) throw new Error(`Cyclic job dependency at ${job.id}`);
    visited.add(job.id);

    const paths = this.registry.jobDependencies.listForJob(job.id)
      .map((dependency) => this.registry.jobs.get(dependency.dependsOnJobId))
      .filter((dependency): dependency is Job => dependency !== undefined)
      .map((dependency) => this.locateFrom(dependency, new Set(visited)))
      .filter((path): path is string => path !== null);
    const unique = [...new Set(paths)];
    if (unique.length > 1) throw new Error(`Job ${job.id} depends on multiple worktrees`);
    return unique[0] ?? null;
  }
}
