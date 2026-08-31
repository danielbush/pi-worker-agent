import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DemoWorkerService } from "../application/demo-worker-service.ts";
import { getDataRoot } from "../storage/paths.ts";
import { Registry } from "../storage/registry.ts";
import { WorkerMonitor } from "./worker-monitor.ts";

export class WorkerAgentExtension {
  private readonly root = getDataRoot();
  private readonly monitor: WorkerMonitor;
  private readonly demoWorkers: DemoWorkerService;
  private registry: Registry | undefined;

  constructor(private readonly pi: ExtensionAPI) {
    const runnerPath = fileURLToPath(new URL("../runner/main.ts", import.meta.url));
    this.monitor = new WorkerMonitor(pi, () => this.getRegistry());
    this.demoWorkers = new DemoWorkerService(
      this.root,
      runnerPath,
      () => this.getRegistry(),
      () => void this.monitor.poll(),
    );
  }

  register(): void {
    this.registerLifecycle();
    this.registerCommands();
    this.registerTools();
  }

  private getRegistry(): Registry {
    this.registry ??= new Registry(this.root);
    return this.registry;
  }

  private closeRegistry(): void {
    this.registry?.close();
    this.registry = undefined;
  }

  private registerLifecycle(): void {
    this.pi.on("session_start", async (_event, ctx) => {
      this.getRegistry();
      await this.monitor.start(ctx);
    });

    this.pi.on("session_shutdown", async (_event, ctx) => {
      this.monitor.stop(ctx);
      this.closeRegistry();
    });
  }

  private registerCommands(): void {
    this.pi.registerCommand("worker-demo", {
      description: "Start a detached demo worker without invoking the managing model",
      handler: async (args, ctx) => {
        const task = args.trim() || "Demonstrate detached worker lifecycle";
        const job = this.demoWorkers.start(ctx, task);
        ctx.ui.notify(`Started ${job.id.slice(0, 12)}`, "info");
      },
    });
  }

  private registerTools(): void {
    this.pi.registerTool({
      name: "worker_start",
      label: "Start Worker",
      description: "Start a detached demo worker. Returns immediately with a durable job ID.",
      promptSnippet: "Start a detached worker and track it by job ID",
      parameters: Type.Object({
        task: Type.String({ description: "Task to give the detached worker" }),
        cwd: Type.Optional(Type.String({ description: "Worker cwd; defaults to the current project" })),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const job = this.demoWorkers.start(ctx, params.task, params.cwd || ctx.cwd);
        return {
          content: [{ type: "text" as const, text: `Started detached worker ${job.id}. Use worker_get or worker_list to inspect it.` }],
          details: { jobId: job.id, status: job.status, bundlePath: job.bundlePath },
        };
      },
    });

    this.pi.registerTool({
      name: "worker_list",
      label: "List Workers",
      description: "List detached workers owned by the current Pi session.",
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
        const jobs = this.getRegistry().listForSession(ctx.sessionManager.getSessionId());
        const text = jobs.length === 0
          ? "No workers for this Pi session."
          : jobs.map((job) => `${job.id}  ${job.status}  ${job.progress || ""}  ${job.task}`).join("\n");
        return { content: [{ type: "text" as const, text }], details: { jobs } };
      },
    });

    this.pi.registerTool({
      name: "worker_get",
      label: "Get Worker",
      description: "Get one detached worker's status and final result.",
      parameters: Type.Object({ jobId: Type.String({ description: "Durable worker job ID" }) }),
      execute: async (_toolCallId, params) => this.getWorker(params.jobId),
    });
  }

  private getWorker(jobId: string) {
    const job = this.getRegistry().get(jobId);
    if (!job) throw new Error(`Unknown worker: ${jobId}`);

    let result: string | undefined;
    if (job.resultPath) {
      try {
        result = readFileSync(job.resultPath, "utf8");
      } catch {
        result = undefined;
      }
    }

    const text = [
      `Job: ${job.id}`,
      `Status: ${job.status}`,
      `Progress: ${job.progress || "-"}`,
      `Task: ${job.task}`,
      `Bundle: ${job.bundlePath}`,
      result ? `\nResult:\n${result}` : "",
      job.error ? `\nError:\n${job.error}` : "",
    ].filter(Boolean).join("\n");

    return { content: [{ type: "text" as const, text }], details: { job, result } };
  }
}
