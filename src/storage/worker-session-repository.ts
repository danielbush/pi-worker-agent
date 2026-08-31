import type { WorkerSession } from "../domain/worker-session.ts";
import type { RegistryDatabase } from "./registry-database.ts";

/** INFRASTRUCTURE_CONSUMER: persists metadata and `workerSessions` harness pointers. */
export class WorkerSessionRepository {
  private constructor(
    private readonly database: RegistryDatabase | undefined,
    private readonly records: Map<string, WorkerSession> | undefined,
  ) {}

  static create(database: RegistryDatabase): WorkerSessionRepository {
    return new WorkerSessionRepository(database, undefined);
  }

  static createNull(sessions: WorkerSession[] = []): WorkerSessionRepository {
    return new WorkerSessionRepository(undefined, new Map(sessions.map((session) => [session.id, structuredClone(session)])));
  }

  create(session: WorkerSession): void {
    if (this.records) {
      if (this.records.has(session.id)) throw new Error(`Duplicate worker session: ${session.id}`);
      this.records.set(session.id, structuredClone(session));
      return;
    }
    this.database!.db.query(`
      INSERT INTO workerSessions (
        id, jobId, harnessSessionId, harnessSessionPath, storagePath, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      session.id, session.jobId, session.harnessSessionId,
      session.harnessSessionPath, session.storagePath, session.createdAt,
    );
  }

  get(id: string): WorkerSession | undefined {
    if (this.records) return clone(this.records.get(id));
    return (this.database!.db.query("SELECT * FROM workerSessions WHERE id = ?").get(id) as WorkerSession | null) ?? undefined;
  }

  getForJob(jobId: string): WorkerSession | undefined {
    if (this.records) return clone([...this.records.values()].find((session) => session.jobId === jobId));
    return (this.database!.db.query("SELECT * FROM workerSessions WHERE jobId = ?").get(jobId) as WorkerSession | null) ?? undefined;
  }

  setHarnessSession(id: string, harnessSessionId: string, harnessSessionPath: string | null): void {
    if (this.records) {
      const session = this.records.get(id);
      if (session) Object.assign(session, { harnessSessionId, harnessSessionPath });
      return;
    }
    this.database!.db.query(`
      UPDATE workerSessions SET harnessSessionId = ?, harnessSessionPath = ? WHERE id = ?
    `).run(harnessSessionId, harnessSessionPath, id);
  }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
