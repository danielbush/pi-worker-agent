import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { WorkerAgentPaths } from "../../storage/paths.ts";

export interface CreateJobFiles {
  taskId: string;
  jobId: string;
  request: string;
}

/**
 * INFRASTRUCTURE_WRAPPER.
 * Stores the architecture's file-based job data under
 * `tasks/<task-id>/jobs/<job-id>/`. `request.md` is the canonical job prompt;
 * query-friendly metadata belongs to the `jobs` database table.
 */
export class JobFiles {
  private constructor(
    private readonly paths: WorkerAgentPaths,
    private readonly requests: Map<string, string> | undefined,
  ) {}

  static create(paths: WorkerAgentPaths): JobFiles {
    return new JobFiles(paths, undefined);
  }

  static createNull(
    paths: WorkerAgentPaths,
    requests: Array<{ taskId: string; jobId: string; text: string }> = [],
  ): JobFiles {
    return new JobFiles(paths, new Map(requests.map((request) => [key(request.taskId, request.jobId), request.text])));
  }

  async create(input: CreateJobFiles): Promise<string> {
    const directory = this.paths.job(input.taskId, input.jobId);
    if (this.requests) {
      this.requests.set(key(input.taskId, input.jobId), input.request);
      return directory;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const requestPath = this.paths.request(input.taskId, input.jobId);
    await writeFile(requestPath, input.request, { encoding: "utf8", mode: 0o600 });
    await chmod(requestPath, 0o600);
    return directory;
  }

  async readRequest(taskId: string, jobId: string): Promise<string> {
    if (this.requests) {
      const request = this.requests.get(key(taskId, jobId));
      if (request === undefined) throw new Error(`Unknown request: ${taskId}/${jobId}`);
      return request;
    }
    return Bun.file(this.paths.request(taskId, jobId)).text();
  }
}

function key(taskId: string, jobId: string): string {
  return `${taskId}\0${jobId}`;
}
