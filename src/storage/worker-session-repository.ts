import type { WorkerSession } from "../domain/worker-session.ts";
import type { RegistryDatabase } from "./registry-database.ts";

/** Persists basic metadata and harness pointers for `workerSessions`. */
export class WorkerSessionRepository {
  constructor(private readonly database: RegistryDatabase) {}

  create(session: WorkerSession): void {
    this.database.db.query(`
      INSERT INTO workerSessions (
        id, jobId, harnessSessionId, harnessSessionPath, storagePath, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      session.id, session.jobId, session.harnessSessionId,
      session.harnessSessionPath, session.storagePath, session.createdAt,
    );
  }

  get(id: string): WorkerSession | undefined {
    return (this.database.db.query("SELECT * FROM workerSessions WHERE id = ?").get(id) as WorkerSession | null) ?? undefined;
  }

  getForJob(jobId: string): WorkerSession | undefined {
    return (this.database.db.query("SELECT * FROM workerSessions WHERE jobId = ?").get(jobId) as WorkerSession | null) ?? undefined;
  }

  setHarnessSession(id: string, harnessSessionId: string, harnessSessionPath: string | null): void {
    this.database.db.query(`
      UPDATE workerSessions SET harnessSessionId = ?, harnessSessionPath = ? WHERE id = ?
    `).run(harnessSessionId, harnessSessionPath, id);
  }
}
