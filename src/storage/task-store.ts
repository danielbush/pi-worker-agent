import type { WorkerEvent } from "../domain/events.ts";
import { HarnessSessionFiles } from "../infrastructure/filesystem/harness-session-files.ts";
import { JobFiles } from "../infrastructure/filesystem/job-files.ts";
import { TaskFiles } from "../infrastructure/filesystem/task-files.ts";
import { WorkerSessionEvents } from "../infrastructure/filesystem/worker-session-events.ts";
import { WorkerAgentPaths } from "./paths.ts";

export interface NullTaskStoreState {
  requests?: Array<{ taskId: string; jobId: string; text: string }>;
  eventLogs?: Array<{ taskId: string; jobId: string; workerSessionId: string; events?: WorkerEvent[] }>;
  harnessSessionPaths?: Record<string, string | null>;
}

/**
 * INFRASTRUCTURE_CONSUMER.
 * File-based counterpart to the architecture's task → job → worker-session
 * hierarchy. Structured metadata remains the registry's concern.
 */
export class TaskStore {
  readonly paths: WorkerAgentPaths;
  readonly tasks: TaskFiles;
  readonly jobs: JobFiles;
  private readonly harnessSessions: HarnessSessionFiles;
  private readonly eventLogs: Map<string, WorkerEvent[]> | undefined;

  constructor(root: string, nullState?: NullTaskStoreState) {
    this.paths = new WorkerAgentPaths(root);
    this.tasks = nullState ? TaskFiles.createNull(this.paths) : TaskFiles.create(this.paths);
    this.jobs = nullState
      ? JobFiles.createNull(this.paths, nullState.requests)
      : JobFiles.create(this.paths);
    this.harnessSessions = nullState
      ? HarnessSessionFiles.createNull(nullState.harnessSessionPaths)
      : HarnessSessionFiles.create();
    this.eventLogs = nullState
      ? new Map((nullState.eventLogs ?? []).map((log) => [
        eventKey(log.taskId, log.jobId, log.workerSessionId),
        structuredClone(log.events ?? []),
      ]))
      : undefined;
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
    return WorkerSessionEvents.create(this.paths, taskId, jobId, workerSessionId);
  }

  async readRequest(taskId: string, jobId: string): Promise<string> {
    return this.jobs.readRequest(taskId, jobId);
  }

  async prepareHarnessSessionDirectory(storagePath: string): Promise<string> {
    return this.harnessSessions.prepare(storagePath);
  }

  async findHarnessSessionPath(directory: string, sessionId: string): Promise<string | null> {
    return this.harnessSessions.find(directory, sessionId);
  }
}

function eventKey(taskId: string, jobId: string, workerSessionId: string): string {
  return `${taskId}\0${jobId}\0${workerSessionId}`;
}
