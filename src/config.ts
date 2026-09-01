import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_DATA_ROOT = join(repoRoot, "work", "worker-agent");

/** Resolve the root for worker-agent metadata, canonical files, and worktrees. */
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_WORKER_AGENT_DATA_ROOT || env.DATA_ROOT || DEFAULT_DATA_ROOT;
}

/** Root for worker-agent metadata, canonical files, and worktrees. */
export const DATA_ROOT = resolveDataRoot();
