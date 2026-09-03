export const JOB_TYPES = ["investigate", "plan", "implement", "review", "test", "fix"] as const;
/** A policy-defined purpose. Known capabilities are still resolved by application code. */
export type JobType = string;

export type JobStatus = "blocked" | "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";

/** Queryable metadata and current status for one delegated execution in `jobs`. */
export interface Job {
  id: string;
  taskId: string;
  jobType: JobType;
  parentSessionId: string;
  parentSessionFile: string | null;
  /** Explicitly distinguishes historical pre-profile rows from current snapshots. */
  snapshotProvenance?: "current" | "migration-fossil" | null;
  /** Null only when snapshotProvenance is migration-fossil. */
  workerProfile?: string | null;
  profileFingerprint?: string | null;
  /** Canonical JSON object of harness-native profile options; null only for migration fossils. */
  profileOptions?: string | null;
  capabilityProfile?: string | null;
  harness: string;
  harnessVersion?: string | null;
  nativeInvocation?: string | null;
  model: string;
  effortLevel: string;
  modelName: string;
  modelVersion: string;
  title: string;
  status: JobStatus;
  progress: string | null;
  createdAt: string;
  finishedAt: string | null;
  bundlePath: string;
  userNotified: boolean;
  agentNotified: boolean;
}
