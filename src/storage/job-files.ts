import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { WorkerAgentPaths } from "./paths.ts";

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
  constructor(private readonly paths: WorkerAgentPaths) {}

  async create(input: CreateJobFiles): Promise<string> {
    const directory = this.paths.job(input.taskId, input.jobId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const requestPath = this.paths.request(input.taskId, input.jobId);
    await writeFile(requestPath, input.request, { encoding: "utf8", mode: 0o600 });
    await chmod(requestPath, 0o600);
    return directory;
  }
}
