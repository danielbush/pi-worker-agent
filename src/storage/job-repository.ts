import type { Job, JobStatus } from "../domain/job.ts";
import type { RegistryDatabase } from "./registry-database.ts";

interface JobRow extends Omit<Job, "userNotified" | "agentNotified"> {
  userNotified: number;
  agentNotified: number;
}

function mapJob(row: JobRow): Job {
  return { ...row, userNotified: Boolean(row.userNotified), agentNotified: Boolean(row.agentNotified) };
}

/** Persists metadata and current-state projections for the `jobs` table. */
export class JobRepository {
  constructor(private readonly database: RegistryDatabase) {}

  create(job: Job): void {
    this.database.db.query(`
      INSERT INTO jobs (
        id, taskId, jobType, parentSessionId, parentSessionFile, harness, model,
        effortLevel, modelName, modelVersion, title, status, progress, createdAt,
        finishedAt, bundlePath, userNotified, agentNotified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id, job.taskId, job.jobType, job.parentSessionId, job.parentSessionFile,
      job.harness, job.model, job.effortLevel, job.modelName, job.modelVersion,
      job.title, job.status, job.progress, job.createdAt, job.finishedAt,
      job.bundlePath, Number(job.userNotified), Number(job.agentNotified),
    );
  }

  get(id: string): Job | undefined {
    const row = this.database.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
    return row ? mapJob(row) : undefined;
  }

  listForTask(taskId: string): Job[] {
    return (this.database.db.query(`
      SELECT * FROM jobs WHERE taskId = ? ORDER BY createdAt
    `).all(taskId) as JobRow[]).map(mapJob);
  }

  updateStatus(id: string, status: JobStatus, progress: string | null, finishedAt: string | null = null): void {
    this.database.db.query(`
      UPDATE jobs SET status = ?, progress = ?, finishedAt = ? WHERE id = ?
    `).run(status, progress, finishedAt, id);
  }

  markUserNotified(id: string): void {
    this.database.db.query("UPDATE jobs SET userNotified = 1 WHERE id = ?").run(id);
  }

  markAgentNotified(id: string): void {
    this.database.db.query("UPDATE jobs SET agentNotified = 1 WHERE id = ?").run(id);
  }
}
