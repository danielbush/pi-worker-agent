import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_DATA_ROOT = join(homedir(), ".pi", "agent", "worker-agent");

/** Resolve the root for worker-agent metadata, canonical files, and worktrees. */
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_WORKER_AGENT_DATA_ROOT || env.DATA_ROOT || DEFAULT_DATA_ROOT;
}

/** Root for worker-agent metadata, canonical files, and worktrees. */
export const DATA_ROOT = resolveDataRoot();
