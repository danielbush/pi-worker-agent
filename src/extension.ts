import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Registry } from "./db.ts";
import { getDataRoot, getTaskBundle } from "./paths.ts";
import type { Job } from "./types.ts";

const POLL_MS = 1_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function short(text: string, length = 52): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function formatJob(job: Job): string {
  const icon = job.status === "completed" ? "✓" : job.status === "failed" ? "✗" : job.status === "running" ? "⏳" : "○";
  return `${icon} ${job.id.slice(0, 12)} ${short(job.progress || job.task)}`;
}

export default function workerAgentExtension(pi: ExtensionAPI) {
  const root = getDataRoot();
  const runnerPath = fileURLToPath(new URL("./runner.ts", import.meta.url));
  let registry: Registry | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let currentContext: ExtensionContext | undefined;
  let polling = false;

  function ensureRegistry(): Registry {
    registry ??= new Registry(root);
    return registry;
  }

  function startJob(ctx: ExtensionContext, task: string, cwd = ctx.cwd): Job {
    const id = `job_${crypto.randomUUID()}`;
    const bundlePath = getTaskBundle(root, id);
    const job: Job = {
      id,
      parentSessionId: ctx.sessionManager.getSessionId(),
      parentSessionFile: ctx.sessionManager.getSessionFile() ?? null,
      harness: "demo",
      task,
      cwd,
      status: "queued",
      pid: null,
      progress: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      bundlePath,
      resultPath: null,
      error: null,
      userNotified: false,
      agentNotified: false,
    };

    mkdirSync(bundlePath, { recursive: true });
    writeFileSync(`${bundlePath}/request.md`, task, { encoding: "utf8", mode: 0o600 });
    writeFileSync(`${bundlePath}/manifest.json`, JSON.stringify({ schemaVersion: 1, ...job }, null, 2), { encoding: "utf8", mode: 0o600 });
    ensureRegistry().create(job);

    const child = spawn("bun", [runnerPath, "--root", root, "--job", id], {
      cwd: job.cwd,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PI_WORKER_AGENT_DIR: root },
    });
    child.on("error", (error) => ensureRegistry().markFailed(id, error.message));
    child.unref();
    void poll();
    return job;
  }

  async function poll(): Promise<void> {
    if (polling || !currentContext) return;
    polling = true;
    try {
      const ctx = currentContext;
      const sessionId = ctx.sessionManager.getSessionId();
      const jobs = ensureRegistry().listForSession(sessionId);
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
          ctx.ui.notify(`Worker ${job.id.slice(0, 12)} ${job.status}: ${short(job.task)}`, job.status === "completed" ? "info" : "error");
          ensureRegistry().markUserNotified(job.id);
        }
        if (!job.agentNotified) {
          pi.sendMessage(
            {
              customType: "worker-completion",
              content: `Detached worker ${job.id} ${job.status}. Use worker_get with jobId ${job.id} to inspect the result.`,
              display: true,
              details: { jobId: job.id, status: job.status },
            },
            { deliverAs: "nextTurn" },
          );
          ensureRegistry().markAgentNotified(job.id);
        }
      }
    } finally {
      polling = false;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    currentContext = ctx;
    ensureRegistry();
    await poll();
    timer = setInterval(() => void poll(), POLL_MS);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    ctx.ui.setWidget("worker-agent", undefined);
    ctx.ui.setStatus("worker-agent", undefined);
    currentContext = undefined;
    registry?.close();
    registry = undefined;
  });

  pi.registerCommand("worker-demo", {
    description: "Start a detached demo worker without invoking the managing model",
    handler: async (args, ctx) => {
      const task = args.trim() || "Demonstrate detached worker lifecycle";
      const job = startJob(ctx, task);
      ctx.ui.notify(`Started ${job.id.slice(0, 12)}`, "info");
    },
  });

  pi.registerTool({
    name: "worker_start",
    label: "Start Worker",
    description: "Start a detached demo worker. Returns immediately with a durable job ID.",
    promptSnippet: "Start a detached worker and track it by job ID",
    parameters: Type.Object({
      task: Type.String({ description: "Task to give the detached worker" }),
      cwd: Type.Optional(Type.String({ description: "Worker cwd; defaults to the current project" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const job = startJob(ctx, params.task, params.cwd || ctx.cwd);
      return {
        content: [{ type: "text", text: `Started detached worker ${job.id}. Use worker_get or worker_list to inspect it.` }],
        details: { jobId: job.id, status: job.status, bundlePath: job.bundlePath },
      };
    },
  });

  pi.registerTool({
    name: "worker_list",
    label: "List Workers",
    description: "List detached workers owned by the current Pi session.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const jobs = ensureRegistry().listForSession(ctx.sessionManager.getSessionId());
      const text = jobs.length === 0
        ? "No workers for this Pi session."
        : jobs.map((job) => `${job.id}  ${job.status}  ${job.progress || ""}  ${job.task}`).join("\n");
      return { content: [{ type: "text", text }], details: { jobs } };
    },
  });

  pi.registerTool({
    name: "worker_get",
    label: "Get Worker",
    description: "Get one detached worker's status and final result.",
    parameters: Type.Object({ jobId: Type.String({ description: "Durable worker job ID" }) }),
    async execute(_toolCallId, params) {
      const job = ensureRegistry().get(params.jobId);
      if (!job) throw new Error(`Unknown worker: ${params.jobId}`);
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
      return { content: [{ type: "text", text }], details: { job, result } };
    },
  });
}
