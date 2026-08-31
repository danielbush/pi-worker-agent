import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Job } from "../domain/job.ts";
import { getTaskBundle } from "../storage/paths.ts";
import type { Registry } from "../storage/registry.ts";

/**
 * Creates durable demo jobs and launches the model-free detached runner.
 *
 * This temporary application service backs `/worker-demo` and `worker_start`
 * while exercising the same registry, file-storage, and monitoring lifecycle
 * that real harness adapters will use.
 */
export class DemoWorkerService {
  constructor(
    private readonly root: string,
    private readonly runnerPath: string,
    private readonly getRegistry: () => Registry,
    private readonly onJobStarted: () => void,
  ) {}

  start(ctx: ExtensionContext, task: string, cwd = ctx.cwd): Job {
    const id = `job_${crypto.randomUUID()}`;
    const bundlePath = getTaskBundle(this.root, id);
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
    writeFileSync(`${bundlePath}/manifest.json`, JSON.stringify({ schemaVersion: 1, ...job }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    this.getRegistry().create(job);

    const child = spawn("bun", [this.runnerPath, "--root", this.root, "--job", id], {
      cwd: job.cwd,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PI_WORKER_AGENT_DIR: this.root },
    });
    child.on("error", (error) => this.getRegistry().markFailed(id, error.message));
    child.unref();
    this.onJobStarted();
    return job;
  }
}
