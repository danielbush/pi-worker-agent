import type { WorkerEvent } from "../../domain/events.ts";
import { WorkerSessionEvents } from "../../infrastructure/filesystem/worker-session-events.ts";
import type { WorkerAgentPaths } from "../paths.ts";

export interface NullWorkerSessionEventLog {
  taskId: string;
  jobId: string;
  workerSessionId: string;
  events?: WorkerEvent[];
}

type EventLogLocator = (
  taskId: string,
  jobId: string,
  workerSessionId: string,
) => WorkerSessionEvents;

/** INFRASTRUCTURE_CONSUMER: locates canonical event logs for worker sessions. */
export class WorkerSessionEventLogs {
  constructor(private readonly locate: EventLogLocator) {}

  static create(paths: WorkerAgentPaths): WorkerSessionEventLogs {
    return new WorkerSessionEventLogs((taskId, jobId, workerSessionId) => (
      WorkerSessionEvents.create(paths, taskId, jobId, workerSessionId)
    ));
  }

  static createNull(logs: NullWorkerSessionEventLog[] = []): WorkerSessionEventLogs {
    const records = new Map(logs.map((log) => [
      key(log.taskId, log.jobId, log.workerSessionId),
      structuredClone(log.events ?? []),
    ]));
    return new WorkerSessionEventLogs((taskId, jobId, workerSessionId) => {
      const logKey = key(taskId, jobId, workerSessionId);
      let events = records.get(logKey);
      if (!events) {
        events = [];
        records.set(logKey, events);
      }
      return WorkerSessionEvents.createNull(taskId, jobId, workerSessionId, events);
    });
  }

  events(taskId: string, jobId: string, workerSessionId: string): WorkerSessionEvents {
    return this.locate(taskId, jobId, workerSessionId);
  }
}

function key(taskId: string, jobId: string, workerSessionId: string): string {
  return `${taskId}\0${jobId}\0${workerSessionId}`;
}
