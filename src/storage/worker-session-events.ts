import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { WorkerEvent } from "../domain/events.ts";
import type { WorkerAgentPaths } from "./paths.ts";

/**
 * INFRASTRUCTURE_WRAPPER.
 * Stores the architecture's canonical `events.jsonl` for one `workerSessions`
 * record under its task and job. Harness identity and storage pointers belong
 * to the database record; observable worker activity belongs here.
 */
export class WorkerSessionEvents {
  readonly path: string;

  constructor(
    private readonly paths: WorkerAgentPaths | undefined,
    readonly taskId: string,
    readonly jobId: string,
    readonly workerSessionId: string,
    private readonly records: WorkerEvent[] | undefined = undefined,
  ) {
    this.path = paths?.events(taskId, jobId, workerSessionId) ?? `null://${taskId}/${jobId}/${workerSessionId}/events.jsonl`;
  }

  static createNull(
    taskId: string,
    jobId: string,
    workerSessionId: string,
    records: WorkerEvent[] = [],
  ): WorkerSessionEvents {
    return new WorkerSessionEvents(undefined, taskId, jobId, workerSessionId, records);
  }

  async create(): Promise<void> {
    if (this.records) return;
    await mkdir(this.paths!.workerSession(this.taskId, this.jobId, this.workerSessionId), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(this.path, "", { encoding: "utf8", flag: "a", mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  async append(event: WorkerEvent): Promise<void> {
    if (this.records) {
      this.records.push(structuredClone(event));
      return;
    }
    await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async readAll(): Promise<WorkerEvent[]> {
    if (this.records) return structuredClone(this.records);
    const content = await readFile(this.path, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorkerEvent);
  }
}
