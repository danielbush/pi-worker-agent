import type { Job, JobStatus } from "../domain/job.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface JobRow extends Omit<Job, "userNotified" | "agentNotified"> {
  userNotified: number;
  agentNotified: number;
}

interface JobPersistence {
  create(job: Job): void;
  get(id: string): Job | undefined;
  listForTask(taskId: string): Job[];
  listUnnotifiedSettledForParent(parentSessionId: string): Job[];
  updateStatus(id: string, status: JobStatus, progress: string | null, finishedAt: string | null): void;
  markUserNotified(id: string): void;
  markAgentNotified(id: string): void;
}

/** INFRASTRUCTURE_CONSUMER: persists projections in the `jobs` table. */
export class JobRepository {
  constructor(private readonly persistence: JobPersistence) {}

  static create(database: RegistryDatabase): JobRepository {
    return new JobRepository({
      create: (job) => database.db.query(`
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
      ),
      get: (id) => mapOptional(database.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null),
      listForTask: (taskId) => (database.db.query("SELECT * FROM jobs WHERE taskId = ? ORDER BY createdAt").all(taskId) as JobRow[]).map(mapJob),
      listUnnotifiedSettledForParent: (parentSessionId) => (database.db.query(`
        SELECT * FROM jobs WHERE parentSessionId = ?
          AND status IN ('completed', 'failed', 'cancelled', 'skipped')
          AND (userNotified = 0 OR agentNotified = 0)
        ORDER BY finishedAt, createdAt
      `).all(parentSessionId) as JobRow[]).map(mapJob),
      updateStatus: (id, status, progress, finishedAt) => { database.db.query(`
        UPDATE jobs SET status = ?, progress = ?, finishedAt = ? WHERE id = ?
      `).run(status, progress, finishedAt, id); },
      markUserNotified: (id) => { database.db.query("UPDATE jobs SET userNotified = 1 WHERE id = ?").run(id); },
      markAgentNotified: (id) => { database.db.query("UPDATE jobs SET agentNotified = 1 WHERE id = ?").run(id); },
    });
  }

  static createNull(jobs: Job[] = []): JobRepository {
    const records = new Map(jobs.map((job) => [job.id, structuredClone(job)]));
    const settled = new Set<JobStatus>(["completed", "failed", "cancelled", "skipped"]);
    return new JobRepository({
      create: (job) => {
        if (records.has(job.id)) throw new Error(`Duplicate job: ${job.id}`);
        records.set(job.id, structuredClone(job));
      },
      get: (id) => clone(records.get(id)),
      listForTask: (taskId) => [...records.values()].filter((job) => job.taskId === taskId)
        .map((job) => structuredClone(job)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      listUnnotifiedSettledForParent: (parentSessionId) => [...records.values()]
        .filter((job) => job.parentSessionId === parentSessionId)
        .filter((job) => settled.has(job.status) && (!job.userNotified || !job.agentNotified))
        .map((job) => structuredClone(job))
        .sort((a, b) => (a.finishedAt ?? a.createdAt).localeCompare(b.finishedAt ?? b.createdAt)),
      updateStatus: (id, status, progress, finishedAt) => {
        const job = records.get(id); if (job) Object.assign(job, { status, progress, finishedAt });
      },
      markUserNotified: (id) => { const job = records.get(id); if (job) job.userNotified = true; },
      markAgentNotified: (id) => { const job = records.get(id); if (job) job.agentNotified = true; },
    });
  }

  create(job: Job): void { this.persistence.create(job); }
  get(id: string): Job | undefined { return this.persistence.get(id); }
  listForTask(taskId: string): Job[] { return this.persistence.listForTask(taskId); }
  listUnnotifiedSettledForParent(parentSessionId: string): Job[] { return this.persistence.listUnnotifiedSettledForParent(parentSessionId); }
  updateStatus(id: string, status: JobStatus, progress: string | null, finishedAt: string | null = null): void {
    this.persistence.updateStatus(id, status, progress, finishedAt);
  }
  markUserNotified(id: string): void { this.persistence.markUserNotified(id); }
  markAgentNotified(id: string): void { this.persistence.markAgentNotified(id); }
}

function mapJob(row: JobRow): Job {
  return { ...row, userNotified: Boolean(row.userNotified), agentNotified: Boolean(row.agentNotified) };
}
function mapOptional(row: JobRow | null): Job | undefined { return row ? mapJob(row) : undefined; }
function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
