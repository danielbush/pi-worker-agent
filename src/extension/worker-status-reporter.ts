import type { JobStatus } from "../domain/job.ts";
import type { TaskStatus } from "../domain/task.ts";
import { Registry, type NullRegistryState } from "../storage/registry.ts";
import { TaskStore, type NullTaskStoreState } from "../storage/task-store.ts";

export interface WorkerJobStatus {
  id: string;
  type: string;
  title: string;
  status: JobStatus;
  progress: string | null;
  workerSessionId: string | null;
  requestPath: string;
  eventsPath: string | null;
  result: string | null;
}

export interface WorkerTaskStatus {
  id: string;
  title: string;
  status: TaskStatus;
  jobs: WorkerJobStatus[];
}

export interface NullWorkerStatusReporterState {
  registry?: NullRegistryState;
  taskStore?: NullTaskStoreState;
}

/** INFRASTRUCTURE_CONSUMER: reads canonical worker state for manager-facing status output. */
export class WorkerStatusReporter {
  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
  ) {}

  static create(registry: Registry, taskStore: TaskStore): WorkerStatusReporter {
    return new WorkerStatusReporter(registry, taskStore);
  }

  static createNull(state: NullWorkerStatusReporterState = {}): WorkerStatusReporter {
    return new WorkerStatusReporter(
      Registry.createNull(state.registry),
      TaskStore.createNull(state.taskStore),
    );
  }

  async inspect(taskId: string): Promise<WorkerTaskStatus | undefined> {
    const task = this.registry.tasks.get(taskId);
    if (!task) return undefined;

    const jobs = await Promise.all(this.registry.jobs.listForTask(task.id).map(async (job) => {
      const session = this.registry.workerSessions.getForJob(job.id);
      const events = session
        ? await this.taskStore.events(task.id, job.id, session.id).readAll()
        : [];
      const completed = events.findLast((event) => event.type === "assistant.completed");
      const failed = events.findLast((event) => event.type === "error");
      return {
        id: job.id,
        type: job.jobType,
        title: job.title,
        status: job.status,
        progress: job.progress,
        workerSessionId: session?.id ?? null,
        requestPath: this.taskStore.paths.request(task.id, job.id),
        eventsPath: session
          ? this.taskStore.paths.events(task.id, job.id, session.id)
          : null,
        result: completed?.text ?? failed?.error ?? null,
      } satisfies WorkerJobStatus;
    }));

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      jobs,
    };
  }
}

export function formatWorkerStatus(status: WorkerTaskStatus): string {
  const lines = [
    `Task ${status.id}: ${status.title}`,
    `Status: ${status.status}`,
  ];
  for (const job of status.jobs) {
    lines.push(
      "",
      `${job.type} job ${job.id}: ${job.status}`,
      `Progress: ${job.progress ?? "none"}`,
      `Worker session: ${job.workerSessionId ?? "not started"}`,
      `Request: ${job.requestPath}`,
      `Events: ${job.eventsPath ?? "not created"}`,
    );
    if (job.result) lines.push("Result:", job.result);
  }
  return lines.join("\n");
}
