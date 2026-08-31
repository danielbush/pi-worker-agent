import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorkerEvent } from "../domain/events.ts";
import { JobFiles } from "./job-files.ts";
import { WorkerAgentPaths } from "./paths.ts";
import { TaskFiles } from "./task-files.ts";
import { WorkerSessionEvents } from "./worker-session-events.ts";

export interface NullTaskStoreState {
  requests?: Array<{ taskId: string; jobId: string; text: string }>;
  eventLogs?: Array<{ taskId: string; jobId: string; workerSessionId: string; events?: WorkerEvent[] }>;
  harnessSessionPaths?: Record<string, string | null>;
}

/**
 * INFRASTRUCTURE_WRAPPER.
 * File-based counterpart to the architecture's task → job → worker-session
 * hierarchy. It composes `TaskFiles`, `JobFiles`, `WorkerSessionEvents`, and
 * `WorkerAgentPaths`; structured metadata remains the registry's concern.
 */
export class TaskStore {
  readonly paths: WorkerAgentPaths;
  readonly tasks: TaskFiles;
  readonly jobs: JobFiles;
  private readonly requests: Map<string, string> | undefined;
  private readonly eventLogs: Map<string, WorkerEvent[]> | undefined;
  private readonly harnessSessionPaths: Record<string, string | null> | undefined;

  constructor(root: string, nullState?: NullTaskStoreState) {
    this.paths = new WorkerAgentPaths(root);
    this.tasks = new TaskFiles(this.paths);
    this.jobs = new JobFiles(this.paths);
    this.requests = nullState
      ? new Map((nullState.requests ?? []).map((request) => [requestKey(request.taskId, request.jobId), request.text]))
      : undefined;
    this.eventLogs = nullState
      ? new Map((nullState.eventLogs ?? []).map((log) => [
        eventKey(log.taskId, log.jobId, log.workerSessionId),
        structuredClone(log.events ?? []),
      ]))
      : undefined;
    this.harnessSessionPaths = nullState ? (nullState.harnessSessionPaths ?? {}) : undefined;
  }

  static create(root: string): TaskStore {
    return new TaskStore(root);
  }

  static createNull(state: NullTaskStoreState = {}): TaskStore {
    return new TaskStore("/null-worker-agent", state);
  }

  events(taskId: string, jobId: string, workerSessionId: string): WorkerSessionEvents {
    if (this.eventLogs) {
      const key = eventKey(taskId, jobId, workerSessionId);
      let records = this.eventLogs.get(key);
      if (!records) {
        records = [];
        this.eventLogs.set(key, records);
      }
      return WorkerSessionEvents.createNull(taskId, jobId, workerSessionId, records);
    }
    return new WorkerSessionEvents(this.paths, taskId, jobId, workerSessionId);
  }

  async readRequest(taskId: string, jobId: string): Promise<string> {
    if (this.requests) {
      const request = this.requests.get(requestKey(taskId, jobId));
      if (request === undefined) throw new Error(`Unknown request: ${taskId}/${jobId}`);
      return request;
    }
    return Bun.file(this.paths.request(taskId, jobId)).text();
  }

  async prepareHarnessSessionDirectory(storagePath: string): Promise<string> {
    const directory = join(storagePath, "pi-session");
    if (!this.requests) await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async findHarnessSessionPath(directory: string, sessionId: string): Promise<string | null> {
    if (this.harnessSessionPaths) return this.harnessSessionPaths[sessionId] ?? null;
    const entries = await readdir(directory, { withFileTypes: true });
    const sessionFile = entries.find((entry) => entry.isFile() && entry.name.includes(sessionId));
    return sessionFile ? join(directory, sessionFile.name) : null;
  }
}

function requestKey(taskId: string, jobId: string): string {
  return `${taskId}\0${jobId}`;
}

function eventKey(taskId: string, jobId: string, workerSessionId: string): string {
  return `${taskId}\0${jobId}\0${workerSessionId}`;
}
