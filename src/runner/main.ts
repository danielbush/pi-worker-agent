import { PiWorkerRunner } from "./pi-worker-runner.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";

export async function main(args: string[]): Promise<number> {
  const [root, taskId, jobId, workerSessionId] = args;
  if (!root || !taskId || !jobId || !workerSessionId) {
    console.error("Usage: bun src/runner/main.ts <root> <task-id> <job-id> <worker-session-id>");
    return 2;
  }

  const registry = new Registry(root);
  try {
    return await new PiWorkerRunner(registry, new TaskStore(root)).execute({
      taskId,
      jobId,
      workerSessionId,
    });
  } finally {
    registry.close();
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
