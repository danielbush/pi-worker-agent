import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { WorkerAgentPaths } from "../../storage/paths.ts";

export interface CreateJobFiles {
  taskId: string;
  jobId: string;
  request: string;
}

interface JobFileDriver {
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<unknown>;
  writeFile(path: string, content: string, options: { encoding: "utf8"; mode: number }): Promise<unknown>;
  chmod(path: string, mode: number): Promise<unknown>;
  file(path: string): { text(): Promise<string> };
}

/**
 * INFRASTRUCTURE_WRAPPER.
 * Stores the architecture's file-based job data under
 * `tasks/<uuid-prefix>/<task-uuid>/jobs/<job-id>/`. `request.md` is the canonical job prompt;
 * query-friendly metadata belongs to the `jobs` database table.
 */
export class JobFiles {
  constructor(
    private readonly paths: WorkerAgentPaths,
    private readonly driver: JobFileDriver,
    private readonly records: CreateJobFiles[],
  ) {}

  static create(paths: WorkerAgentPaths): JobFiles {
    return new JobFiles(paths, {
      mkdir,
      writeFile,
      chmod,
      file: Bun.file,
    }, []);
  }

  static createNull(
    paths: WorkerAgentPaths,
    requests: Array<{ taskId: string; jobId: string; text: string }> = [],
  ): JobFiles {
    const content = new Map(requests.map((request) => [
      paths.request(request.taskId, request.jobId),
      request.text,
    ]));
    return new JobFiles(paths, {
      mkdir: async () => {},
      writeFile: async (path, text) => { content.set(path, text); },
      chmod: async () => {},
      file: (path) => ({
        text: async () => {
          const text = content.get(path);
          if (text === undefined) throw new Error(`Unknown request path: ${path}`);
          return text;
        },
      }),
    }, requests.map((request) => ({
      taskId: request.taskId,
      jobId: request.jobId,
      request: request.text,
    })));
  }

  get state(): CreateJobFiles[] {
    return structuredClone(this.records);
  }

  async create(input: CreateJobFiles): Promise<string> {
    const directory = this.paths.job(input.taskId, input.jobId);
    await this.driver.mkdir(directory, { recursive: true, mode: 0o700 });
    const requestPath = this.paths.request(input.taskId, input.jobId);
    await this.driver.writeFile(requestPath, input.request, { encoding: "utf8", mode: 0o600 });
    await this.driver.chmod(requestPath, 0o600);
    this.records.push(structuredClone(input));
    return directory;
  }

  async readRequest(taskId: string, jobId: string): Promise<string> {
    return this.driver.file(this.paths.request(taskId, jobId)).text();
  }
}
