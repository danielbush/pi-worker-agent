import type { Job } from "../domain/job.ts";
import type { Registry } from "../storage/registry.ts";
import type { TaskStore } from "../storage/task-store.ts";

export type UserCompletionNotifier = (message: string, level: "info" | "error") => void;
export type AgentCompletionNotifier = (message: string) => void | Promise<void>;

/** INFRASTRUCTURE_CONSUMER: delivers durable worker results to their managing Pi session. */
export class WorkerCompletionMonitor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly notifyUser: UserCompletionNotifier,
    private readonly notifyAgent: AgentCompletionNotifier,
    private readonly intervalMs = 1_000,
  ) {}

  start(parentSessionId: string): void {
    this.stop();
    void this.poll(parentSessionId);
    this.timer = setInterval(() => void this.poll(parentSessionId), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
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
      this.notifyUser(`Worker completion monitor failed: ${detail}`, "error");
    } finally {
      this.polling = false;
    }
  }

  private async deliver(job: Job): Promise<void> {
    const result = await this.resultText(job);
    if (!job.userNotified) {
      const level = job.status === "completed" ? "info" : "error";
      this.notifyUser(
        `${job.title} ${job.status} for task ${job.taskId}.`,
        level,
      );
      this.registry.jobs.markUserNotified(job.id);
    }
    if (!job.agentNotified) {
      await this.notifyAgent([
        `Delegated ${job.jobType} job ${job.id} ${job.status} for task ${job.taskId}.`,
        "",
        "Worker result:",
        result,
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
