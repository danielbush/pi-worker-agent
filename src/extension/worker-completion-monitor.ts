import type { Job } from "../domain/job.ts";
import {
  CompletionNotifications,
  type CompletionNotificationState,
} from "../infrastructure/pi/completion-notifications.ts";
import { IntervalTimer, type IntervalTimerState } from "../infrastructure/system/interval-timer.ts";
import { Registry, type NullRegistryState } from "../storage/registry.ts";
import { TaskStore, type NullTaskStoreState } from "../storage/task-store.ts";

export type UserCompletionNotifier = (message: string, level: "info" | "error") => void;
export type AgentCompletionNotifier = (message: string) => void | Promise<void>;

export interface WorkerCompletionMonitorState {
  notifications: CompletionNotificationState;
  timer: IntervalTimerState;
}

export interface NullWorkerCompletionMonitorState {
  registry?: NullRegistryState;
  taskStore?: NullTaskStoreState;
  intervalMs?: number;
}

/** INFRASTRUCTURE_CONSUMER: delivers durable worker results to their managing Pi session. */
export class WorkerCompletionMonitor {
  private timer: unknown;
  private polling = false;

  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly notifications: CompletionNotifications,
    private readonly intervalTimer: IntervalTimer,
    private readonly intervalMs = 1_000,
  ) {}

  static create(
    registry: Registry,
    taskStore: TaskStore,
    notifyUser: UserCompletionNotifier,
    notifyAgent: AgentCompletionNotifier,
    intervalMs = 1_000,
  ): WorkerCompletionMonitor {
    return new WorkerCompletionMonitor(
      registry,
      taskStore,
      CompletionNotifications.create(notifyUser, notifyAgent),
      IntervalTimer.create(),
      intervalMs,
    );
  }

  static createNull(state: NullWorkerCompletionMonitorState = {}): WorkerCompletionMonitor {
    return new WorkerCompletionMonitor(
      Registry.createNull(state.registry),
      TaskStore.createNull(state.taskStore),
      CompletionNotifications.createNull(),
      IntervalTimer.createNull(),
      state.intervalMs,
    );
  }

  get state(): WorkerCompletionMonitorState {
    return {
      notifications: this.notifications.state,
      timer: this.intervalTimer.state,
    };
  }

  start(parentSessionId: string): void {
    this.stop();
    void this.poll(parentSessionId);
    this.timer = this.intervalTimer.start(() => void this.poll(parentSessionId), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) this.intervalTimer.stop(this.timer);
    this.timer = undefined;
  }

  async pollOnce(parentSessionId: string): Promise<void> {
    const jobs = this.registry.jobs.listUnnotifiedSettledForParent(parentSessionId);
    for (const job of jobs) await this.deliver(job);
  }

  private async poll(parentSessionId: string): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.pollOnce(parentSessionId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.notifications.notifyUser(`Worker completion monitor failed: ${detail}`, "error");
    } finally {
      this.polling = false;
    }
  }

  private async deliver(job: Job): Promise<void> {
    const result = await this.resultText(job);
    if (!job.userNotified) {
      const level = job.status === "completed" ? "info" : "error";
      this.notifications.notifyUser(`${job.title} ${job.status} for task ${job.taskId}.`, level);
      this.registry.jobs.markUserNotified(job.id);
    }
    if (!job.agentNotified) {
      await this.notifications.notifyAgent([
        `Delegated ${job.jobType} job ${job.id} ${job.status} for task ${job.taskId}.`,
        "",
        "Worker result:",
        result,
        "",
        "Re-read the active project and workflow policies, evaluate this result, and perform the next required transition. Stop for failures or ambiguous results.",
      ].join("\n"));
      this.registry.jobs.markAgentNotified(job.id);
    }
  }

  private async resultText(job: Job): Promise<string> {
    const session = this.registry.workerSessions.getForJob(job.id);
    if (!session) return job.progress ?? `Job ${job.status}`;
    const events = await this.taskStore.events(job.taskId, job.id, session.id).readAll();
    if (job.status === "completed") {
      return events.findLast((event) => event.type === "assistant.completed")?.text
        ?? job.progress
        ?? "Worker completed without a final response.";
    }
    return events.findLast((event) => event.type === "error")?.error
      ?? job.progress
      ?? `Job ${job.status}`;
  }
}
