import { join } from "node:path";

/**
 * Maps the architecture's task, job, worker-session, and worktree constructs
 * to their derived locations under the worker-agent data root.
 */
export class WorkerAgentPaths {
  constructor(readonly root: string) {}

  task(taskId: string): string {
    return join(this.root, "tasks", taskId);
  }

  intent(taskId: string): string {
    return join(this.task(taskId), "intent.md");
  }

  outcomes(taskId: string): string {
    return join(this.task(taskId), "outcomes.md");
  }

  background(taskId: string): string {
    return join(this.task(taskId), "background.md");
  }

  job(taskId: string, jobId: string): string {
    return join(this.task(taskId), "jobs", jobId);
  }

  request(taskId: string, jobId: string): string {
    return join(this.job(taskId, jobId), "request.md");
  }

  workerSession(taskId: string, jobId: string, workerSessionId: string): string {
    return join(this.job(taskId, jobId), "worker-sessions", workerSessionId);
  }

  events(taskId: string, jobId: string, workerSessionId: string): string {
    return join(this.workerSession(taskId, jobId, workerSessionId), "events.jsonl");
  }

  worktree(jobId: string): string {
    return join(this.root, "worktrees", jobId);
  }
}
