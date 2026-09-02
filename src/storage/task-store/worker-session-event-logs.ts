import type { WorkerEvent } from "../../domain/events.ts";
import { WorkerSessionEvents } from "../../infrastructure/filesystem/worker-session-events.ts";
import type { WorkerAgentPaths } from "../paths.ts";

export interface NullWorkerSessionEventLog {
  taskId: string;
  jobId: string;
  workerSessionId: string;
  events?: WorkerEvent[];
  appendError?: string;
}

interface EventLogLocator {
  events(taskId: string, jobId: string, workerSessionId: string): WorkerSessionEvents;
}

/** INFRASTRUCTURE_CONSUMER: locates canonical event logs for worker sessions. */
export class WorkerSessionEventLogs {
  constructor(private readonly locate: EventLogLocator) {}

  static create(paths: WorkerAgentPaths): WorkerSessionEventLogs {
    return new WorkerSessionEventLogs({
      events: (taskId, jobId, workerSessionId) => (
        WorkerSessionEvents.create(paths, taskId, jobId, workerSessionId)
      ),
    });
  }

  static createNull(logs: NullWorkerSessionEventLog[] = []): WorkerSessionEventLogs {
    const records = new Map(logs.map((log) => [
      key(log.taskId, log.jobId, log.workerSessionId),
      { events: structuredClone(log.events ?? []), appendError: log.appendError },
    ]));
    return new WorkerSessionEventLogs({
      events: (taskId, jobId, workerSessionId) => {
        const logKey = key(taskId, jobId, workerSessionId);
        let record = records.get(logKey);
        if (!record) {
          record = { events: [], appendError: undefined };
          records.set(logKey, record);
        }
        return WorkerSessionEvents.createNull(taskId, jobId, workerSessionId, record.events, record.appendError);
      },
    });
  }

  events(taskId: string, jobId: string, workerSessionId: string): WorkerSessionEvents {
    return this.locate.events(taskId, jobId, workerSessionId);
  }
}

function key(taskId: string, jobId: string, workerSessionId: string): string {
  return `${taskId}\0${jobId}\0${workerSessionId}`;
}
