import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Job, JobStatus } from "../domain/jobs.ts";

interface JobRow {
  id: string;
  parent_session_id: string;
  parent_session_file: string | null;
  harness: "demo";
  task: string;
  cwd: string;
  status: JobStatus;
  pid: number | null;
  progress: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  bundle_path: string;
  result_path: string | null;
  error: string | null;
  user_notified: number;
  agent_notified: number;
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id,
    parentSessionFile: row.parent_session_file,
    harness: row.harness,
    task: row.task,
    cwd: row.cwd,
    status: row.status,
    pid: row.pid,
    progress: row.progress,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    bundlePath: row.bundle_path,
    resultPath: row.result_path,
    error: row.error,
    userNotified: Boolean(row.user_notified),
    agentNotified: Boolean(row.agent_notified),
  };
}

export class Registry {
  readonly db: Database;

  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new Database(join(root, "registry.sqlite"), { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        parent_session_file TEXT,
        harness TEXT NOT NULL,
        task TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        pid INTEGER,
        progress TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        exit_code INTEGER,
        bundle_path TEXT NOT NULL,
        result_path TEXT,
        error TEXT,
        user_notified INTEGER NOT NULL DEFAULT 0,
        agent_notified INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS jobs_parent_created
        ON jobs(parent_session_id, created_at DESC);
    `);
  }

  create(job: Job): void {
    this.db.query(`
      INSERT INTO jobs (
        id, parent_session_id, parent_session_file, harness, task, cwd, status,
        pid, progress, created_at, started_at, finished_at, exit_code,
        bundle_path, result_path, error, user_notified, agent_notified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id, job.parentSessionId, job.parentSessionFile, job.harness, job.task, job.cwd, job.status,
      job.pid, job.progress, job.createdAt, job.startedAt, job.finishedAt, job.exitCode,
      job.bundlePath, job.resultPath, job.error, Number(job.userNotified), Number(job.agentNotified),
    );
  }

  get(id: string): Job | undefined {
    const row = this.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
    return row ? mapJob(row) : undefined;
  }

  listForSession(parentSessionId: string, limit = 20): Job[] {
    const rows = this.db.query(`
      SELECT * FROM jobs WHERE parent_session_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(parentSessionId, limit) as JobRow[];
    return rows.map(mapJob);
  }

  markRunning(id: string, pid: number): void {
    this.db.query(`
      UPDATE jobs SET status = 'running', pid = ?, progress = 'started', started_at = ? WHERE id = ?
    `).run(pid, new Date().toISOString(), id);
  }

  setProgress(id: string, progress: string): void {
    this.db.query("UPDATE jobs SET progress = ? WHERE id = ?").run(progress, id);
  }

  markCompleted(id: string, resultPath: string): void {
    this.db.query(`
      UPDATE jobs SET status = 'completed', progress = 'done', result_path = ?,
        finished_at = ?, exit_code = 0 WHERE id = ?
    `).run(resultPath, new Date().toISOString(), id);
  }

  markFailed(id: string, error: string, exitCode = 1): void {
    this.db.query(`
      UPDATE jobs SET status = 'failed', progress = 'failed', error = ?,
        finished_at = ?, exit_code = ? WHERE id = ?
    `).run(error, new Date().toISOString(), exitCode, id);
  }

  markUserNotified(id: string): void {
    this.db.query("UPDATE jobs SET user_notified = 1 WHERE id = ?").run(id);
  }

  markAgentNotified(id: string): void {
    this.db.query("UPDATE jobs SET agent_notified = 1 WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }
}
