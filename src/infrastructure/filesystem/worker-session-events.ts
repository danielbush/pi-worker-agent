import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { WorkerEvent } from "../../domain/events.ts";
import type { WorkerAgentPaths } from "../../storage/paths.ts";

interface WorkerSessionEventPaths {
  workerSession(taskId: string, jobId: string, workerSessionId: string): string;
  events(taskId: string, jobId: string, workerSessionId: string): string;
}

interface WorkerSessionEventFileDriver {
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<unknown>;
  writeFile(path: string, content: string, options: { encoding: "utf8"; flag: "a"; mode: number }): Promise<unknown>;
  chmod(path: string, mode: number): Promise<unknown>;
  appendFile(path: string, content: string, options: { encoding: "utf8"; mode: number }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

/**
 * INFRASTRUCTURE_WRAPPER.
 * Stores the architecture's canonical `events.jsonl` for one `workerSessions`
 * record under its task and job. Harness identity and storage pointers belong
 * to the database record; observable worker activity belongs here.
 */
export class WorkerSessionEvents {
  readonly path: string;

  constructor(
    private readonly paths: WorkerSessionEventPaths,
    private readonly driver: WorkerSessionEventFileDriver,
    readonly taskId: string,
    readonly jobId: string,
    readonly workerSessionId: string,
  ) {
    this.path = paths.events(taskId, jobId, workerSessionId);
  }

  static create(
    paths: WorkerAgentPaths,
    taskId: string,
    jobId: string,
    workerSessionId: string,
  ): WorkerSessionEvents {
    return new WorkerSessionEvents(
      paths,
      { mkdir, writeFile, chmod, appendFile, readFile },
      taskId,
      jobId,
      workerSessionId,
    );
  }

  static createNull(
    taskId: string,
    jobId: string,
    workerSessionId: string,
    records: WorkerEvent[] = [],
    appendError?: string,
  ): WorkerSessionEvents {
    return new WorkerSessionEvents(
      {
        workerSession: (task, job, session) => `null://${task}/${job}/${session}`,
        events: (task, job, session) => `null://${task}/${job}/${session}/events.jsonl`,
      },
      {
        mkdir: async () => {},
        writeFile: async () => {},
        chmod: async () => {},
        appendFile: async (_path, text) => {
          if (appendError) throw new Error(appendError);
          records.push(JSON.parse(text) as WorkerEvent);
        },
        readFile: async () => records.map((event) => `${JSON.stringify(event)}\n`).join(""),
      },
      taskId,
      jobId,
      workerSessionId,
    );
  }

  async create(): Promise<void> {
    await this.driver.mkdir(this.paths.workerSession(this.taskId, this.jobId, this.workerSessionId), {
      recursive: true,
      mode: 0o700,
    });
    await this.driver.writeFile(this.path, "", { encoding: "utf8", flag: "a", mode: 0o600 });
    await this.driver.chmod(this.path, 0o600);
  }

  async append(event: WorkerEvent): Promise<void> {
    await this.driver.appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async readAll(): Promise<WorkerEvent[]> {
    const content = await this.driver.readFile(this.path, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorkerEvent);
  }
}
