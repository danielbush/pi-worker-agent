import { PiWorkerRunner } from "./pi-worker-runner.ts";

export async function main(args: string[]): Promise<number> {
  const [root, taskId, jobId, workerSessionId] = args;
  if (!root || !taskId || !jobId || !workerSessionId) {
    console.error("Usage: bun src/runner/main.ts <root> <task-id> <job-id> <worker-session-id>");
    return 2;
  }

  const runner = PiWorkerRunner.create(root);
  try {
    return await runner.execute({ taskId, jobId, workerSessionId });
  } finally {
    runner.close();
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
