import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Job } from "../domain/jobs.ts";
import type { Registry } from "../storage/registry.ts";

const POLL_MS = 1_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function short(text: string, length = 52): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function formatJob(job: Job): string {
  const icon = job.status === "completed" ? "✓" : job.status === "failed" ? "✗" : job.status === "running" ? "⏳" : "○";
  return `${icon} ${job.id.slice(0, 12)} ${short(job.progress || job.task)}`;
}

export class WorkerMonitor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private context: ExtensionContext | undefined;
  private polling = false;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly getRegistry: () => Registry,
  ) {}

  async start(ctx: ExtensionContext): Promise<void> {
    this.stopTimer();
    this.context = ctx;
    await this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(ctx: ExtensionContext): void {
    this.stopTimer();
    ctx.ui.setWidget("worker-agent", undefined);
    ctx.ui.setStatus("worker-agent", undefined);
    this.context = undefined;
  }

  async poll(): Promise<void> {
    if (this.polling || !this.context) return;
    this.polling = true;
    try {
      const ctx = this.context;
      const registry = this.getRegistry();
      const sessionId = ctx.sessionManager.getSessionId();
      const jobs = registry.listForSession(sessionId);
      const active = jobs.filter((job) => !TERMINAL.has(job.status));
      const done = jobs.filter((job) => TERMINAL.has(job.status));

      if (jobs.length > 0) {
        ctx.ui.setWidget("worker-agent", [
          `Workers — ${active.length} active, ${done.length} finished`,
          ...jobs.slice(0, 6).map(formatJob),
        ]);
        ctx.ui.setStatus("worker-agent", `workers: ${active.length} active, ${done.length} done`);
      } else {
        ctx.ui.setWidget("worker-agent", undefined);
        ctx.ui.setStatus("worker-agent", undefined);
      }

      for (const job of done) {
        if (!job.userNotified) {
          ctx.ui.notify(
            `Worker ${job.id.slice(0, 12)} ${job.status}: ${short(job.task)}`,
            job.status === "completed" ? "info" : "error",
          );
          registry.markUserNotified(job.id);
        }
        if (!job.agentNotified) {
          this.pi.sendMessage(
            {
              customType: "worker-completion",
              content: `Detached worker ${job.id} ${job.status}. Use worker_get with jobId ${job.id} to inspect the result.`,
              display: true,
              details: { jobId: job.id, status: job.status },
            },
            { deliverAs: "nextTurn" },
          );
          registry.markAgentNotified(job.id);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
