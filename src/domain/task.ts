export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Queryable metadata and current status for one user objective in `tasks`. */
export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  status: TaskStatus;
  createdAt: string;
  finishedAt: string | null;
}
