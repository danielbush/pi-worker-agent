import { JobFiles } from "./job-files.ts";
import { WorkerAgentPaths } from "./paths.ts";
import { TaskFiles } from "./task-files.ts";
import { WorkerSessionEvents } from "./worker-session-events.ts";

/**
 * File-based counterpart to the architecture's task → job → worker-session
 * hierarchy. It composes `TaskFiles`, `JobFiles`, `WorkerSessionEvents`, and
 * `WorkerAgentPaths`; structured metadata remains the registry's concern.
 */
export class TaskStore {
  readonly paths: WorkerAgentPaths;
  readonly tasks: TaskFiles;
  readonly jobs: JobFiles;

  constructor(root: string) {
    this.paths = new WorkerAgentPaths(root);
    this.tasks = new TaskFiles(this.paths);
    this.jobs = new JobFiles(this.paths);
  }

  events(taskId: string, jobId: string, workerSessionId: string): WorkerSessionEvents {
    return new WorkerSessionEvents(this.paths, taskId, jobId, workerSessionId);
  }
}
