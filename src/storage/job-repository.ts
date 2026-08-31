import type { Job, JobStatus } from "../domain/job.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface JobRow extends Omit<Job, "userNotified" | "agentNotified"> {
  userNotified: number;
  agentNotified: number;
}

function mapJob(row: JobRow): Job {
  return { ...row, userNotified: Boolean(row.userNotified), agentNotified: Boolean(row.agentNotified) };
}

/** INFRASTRUCTURE_CONSUMER: persists projections in the `jobs` table. */
export class JobRepository {
  private constructor(
    private readonly database: RegistryDatabase | undefined,
    private readonly records: Map<string, Job> | undefined,
  ) {}

  static create(database: RegistryDatabase): JobRepository {
    return new JobRepository(database, undefined);
  }

  static createNull(jobs: Job[] = []): JobRepository {
    return new JobRepository(undefined, new Map(jobs.map((job) => [job.id, structuredClone(job)])));
  }

  create(job: Job): void {
    if (this.records) {
      if (this.records.has(job.id)) throw new Error(`Duplicate job: ${job.id}`);
      this.records.set(job.id, structuredClone(job));
      return;
    }
    this.database!.db.query(`
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
    if (this.records) return clone(this.records.get(id));
    const row = this.database!.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
    return row ? mapJob(row) : undefined;
  }

  listForTask(taskId: string): Job[] {
    if (this.records) {
      return [...this.records.values()]
        .filter((job) => job.taskId === taskId)
        .map((job) => structuredClone(job))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return (this.database!.db.query(`
      SELECT * FROM jobs WHERE taskId = ? ORDER BY createdAt
    `).all(taskId) as JobRow[]).map(mapJob);
  }

  listUnnotifiedSettledForParent(parentSessionId: string): Job[] {
    if (this.records) {
      const settled = new Set<JobStatus>(["completed", "failed", "cancelled", "skipped"]);
      return [...this.records.values()]
        .filter((job) => job.parentSessionId === parentSessionId)
        .filter((job) => settled.has(job.status) && (!job.userNotified || !job.agentNotified))
        .map((job) => structuredClone(job))
        .sort((a, b) => (a.finishedAt ?? a.createdAt).localeCompare(b.finishedAt ?? b.createdAt));
    }
    return (this.database!.db.query(`
      SELECT * FROM jobs
      WHERE parentSessionId = ?
        AND status IN ('completed', 'failed', 'cancelled', 'skipped')
        AND (userNotified = 0 OR agentNotified = 0)
      ORDER BY finishedAt, createdAt
    `).all(parentSessionId) as JobRow[]).map(mapJob);
  }

  updateStatus(id: string, status: JobStatus, progress: string | null, finishedAt: string | null = null): void {
    if (this.records) {
      const job = this.records.get(id);
      if (job) Object.assign(job, { status, progress, finishedAt });
      return;
    }
    this.database!.db.query(`
      UPDATE jobs SET status = ?, progress = ?, finishedAt = ? WHERE id = ?
    `).run(status, progress, finishedAt, id);
  }

  markUserNotified(id: string): void {
    if (this.records) {
      const job = this.records.get(id);
      if (job) job.userNotified = true;
      return;
    }
    this.database!.db.query("UPDATE jobs SET userNotified = 1 WHERE id = ?").run(id);
  }

  markAgentNotified(id: string): void {
    if (this.records) {
      const job = this.records.get(id);
      if (job) job.agentNotified = true;
      return;
    }
    this.database!.db.query("UPDATE jobs SET agentNotified = 1 WHERE id = ?").run(id);
  }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
