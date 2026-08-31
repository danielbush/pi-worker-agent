export const JOB_TYPES = ["investigate", "plan", "implement", "review", "test", "fix"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type JobStatus = "blocked" | "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";

/** Queryable metadata and current status for one delegated execution in `jobs`. */
export interface Job {
  id: string;
  taskId: string;
  jobType: JobType;
  parentSessionId: string;
  parentSessionFile: string | null;
  harness: string;
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
