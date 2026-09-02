import type { WorkerEvent } from "../domain/events.ts";
import { HarnessSessionFiles } from "../infrastructure/filesystem/harness-session-files.ts";
import { JobFiles } from "../infrastructure/filesystem/job-files.ts";
import { TaskFiles } from "../infrastructure/filesystem/task-files.ts";
import type { WorkerSessionEvents } from "../infrastructure/filesystem/worker-session-events.ts";
import { WorkerAgentPaths } from "./paths.ts";
import { WorkerSessionEventLogs } from "./task-store/worker-session-event-logs.ts";

export interface NullTaskStoreState {
  requests?: Array<{ taskId: string; jobId: string; text: string }>;
  eventLogs?: Array<{ taskId: string; jobId: string; workerSessionId: string; events?: WorkerEvent[]; appendError?: string }>;
  harnessSessionPaths?: Record<string, string | null>;
}

/**
 * INFRASTRUCTURE_CONSUMER.
 * File-based counterpart to the architecture's task → job → worker-session
 * hierarchy. Structured metadata remains the registry's concern.
 */
export class TaskStore {
  constructor(
    readonly paths: WorkerAgentPaths,
    readonly tasks: TaskFiles,
    readonly jobs: JobFiles,
    private readonly harnessSessions: HarnessSessionFiles,
    private readonly eventLogs: WorkerSessionEventLogs,
  ) {}

  static create(root: string): TaskStore {
    const paths = new WorkerAgentPaths(root);
    return new TaskStore(
      paths,
      TaskFiles.create(paths),
      JobFiles.create(paths),
      HarnessSessionFiles.create(),
      WorkerSessionEventLogs.create(paths),
    );
  }

  static createNull(state: NullTaskStoreState = {}): TaskStore {
    const paths = new WorkerAgentPaths("/null-worker-agent");
    return new TaskStore(
      paths,
      TaskFiles.createNull(paths),
      JobFiles.createNull(paths, state.requests),
      HarnessSessionFiles.createNull(state.harnessSessionPaths),
      WorkerSessionEventLogs.createNull(state.eventLogs),
    );
  }

  events(taskId: string, jobId: string, workerSessionId: string): WorkerSessionEvents {
    return this.eventLogs.events(taskId, jobId, workerSessionId);
  }

  async readRequest(taskId: string, jobId: string): Promise<string> {
    return this.jobs.readRequest(taskId, jobId);
  }

  async prepareHarnessSessionDirectory(storagePath: string): Promise<string> {
    return this.harnessSessions.prepare(storagePath);
  }

  async createPrivateRuntimeDirectory(): Promise<string> {
    return this.harnessSessions.createPrivateRuntimeDirectory();
  }

  async removePrivateRuntimeDirectory(path: string): Promise<void> {
    await this.harnessSessions.removePrivateRuntimeDirectory(path);
  }

  async findHarnessSessionPath(directory: string, sessionId: string): Promise<string | null> {
    return this.harnessSessions.find(directory, sessionId);
  }
}
