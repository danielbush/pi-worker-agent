import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Registry } from "../storage/registry.ts";

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

const root = getArg("--root");
const jobId = getArg("--job");
if (!root || !jobId) throw new Error("Usage: bun runner.ts --root <path> --job <id>");

const registry = new Registry(root);
const job = registry.get(jobId);
if (!job) {
  registry.close();
  throw new Error(`Unknown job: ${jobId}`);
}

const eventsPath = join(job.bundlePath, "events.jsonl");

async function event(type: string, payload: Record<string, unknown> = {}): Promise<void> {
  await appendFile(eventsPath, `${JSON.stringify({ timestamp: new Date().toISOString(), type, ...payload })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

try {
  await mkdir(job.bundlePath, { recursive: true });
  registry.markRunning(job.id, process.pid);
  await event("job.started", { pid: process.pid, harness: job.harness });

  // Deliberately model-free first slice: enough time to observe detached
  // progress and UI updates.
  const stepDelayMs = Number(process.env.PI_WORKER_DEMO_STEP_MS || 1_000);
  const steps = ["reading task", "doing detached work", "writing result"];
  for (const step of steps) {
    registry.setProgress(job.id, step);
    await event("job.progress", { message: step });
    await Bun.sleep(stepDelayMs);
  }

  const resultPath = join(job.bundlePath, "final.md");
  const result = [
    `# Demo worker result`,
    "",
    `Task: ${job.task}`,
    "",
    `The detached worker completed successfully in process ${process.pid}.`,
  ].join("\n");
  await writeAtomic(resultPath, result);
  await event("job.completed", { resultPath });
  registry.markCompleted(job.id, resultPath);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  try {
    await event("job.failed", { error: message });
  } finally {
    registry.markFailed(job.id, message);
  }
  process.exitCode = 1;
} finally {
  registry.close();
}
