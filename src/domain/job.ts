import type { CapabilityProfile, HarnessName } from "./execution-profile.ts";

/** Stable ID of a manager-configured job type. */
export type JobType = string;

export type AgentProfileSelectionSource = "job-type-default" | "task-override" | "migration-fossil";

export type JobStatus = "blocked" | "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";

/** Queryable metadata and current status for one delegated execution in `jobs`. */
export interface Job {
  id: string;
  taskId: string;
  jobTypeId: JobType;
  agentProfileId: string;
  agentProfileSelectionSource: AgentProfileSelectionSource;
  parentSessionId: string;
  parentSessionFile: string | null;
  /** Explicitly distinguishes historical pre-profile rows from current snapshots. */
  snapshotProvenance: "current" | "migration-fossil";
  profileFingerprint: string | null;
  /** Canonical JSON object of harness-native profile options; null only for migration fossils. */
  profileOptions: string | null;
  capabilityProfile: CapabilityProfile | null;
  harness: HarnessName;
  harnessVersion: string | null;
  nativeInvocation: string | null;
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
