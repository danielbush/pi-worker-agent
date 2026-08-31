import { homedir } from "node:os";
import { join } from "node:path";

export function getDataRoot(): string {
  return process.env.PI_WORKER_AGENT_DIR || join(homedir(), ".pi", "agent", "worker-agent");
}

export function getTaskBundle(root: string, jobId: string): string {
  return join(root, "tasks", jobId);
}
