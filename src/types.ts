export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  parentSessionId: string;
  parentSessionFile: string | null;
  harness: "demo";
  task: string;
  cwd: string;
  status: JobStatus;
  pid: number | null;
  progress: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  bundlePath: string;
  resultPath: string | null;
  error: string | null;
  userNotified: boolean;
  agentNotified: boolean;
}
