import type { WorkerSession } from "../domain/worker-session.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface WorkerSessionPersistence {
  create(session: WorkerSession): void;
  get(id: string): WorkerSession | undefined;
  getForJob(jobId: string): WorkerSession | undefined;
  setHarnessSession(id: string, harnessSessionId: string, harnessSessionPath: string | null): void;
}

/** INFRASTRUCTURE_CONSUMER: persists metadata and `workerSessions` harness pointers. */
export class WorkerSessionRepository {
  constructor(private readonly persistence: WorkerSessionPersistence) {}

  static create(database: RegistryDatabase): WorkerSessionRepository {
    return new WorkerSessionRepository({
      create: (session) => database.db.query(`
        INSERT INTO workerSessions (id, jobId, harnessSessionId, harnessSessionPath, storagePath, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(session.id, session.jobId, session.harnessSessionId, session.harnessSessionPath, session.storagePath, session.createdAt),
      get: (id) => (database.db.query("SELECT * FROM workerSessions WHERE id = ?").get(id) as WorkerSession | null) ?? undefined,
      getForJob: (jobId) => (database.db.query("SELECT * FROM workerSessions WHERE jobId = ?").get(jobId) as WorkerSession | null) ?? undefined,
      setHarnessSession: (id, harnessSessionId, harnessSessionPath) => { database.db.query(`
        UPDATE workerSessions SET harnessSessionId = ?, harnessSessionPath = ? WHERE id = ?
      `).run(harnessSessionId, harnessSessionPath, id); },
    });
  }

  static createNull(sessions: WorkerSession[] = []): WorkerSessionRepository {
    const records = new Map(sessions.map((session) => [session.id, structuredClone(session)]));
    return new WorkerSessionRepository({
      create: (session) => {
        if (records.has(session.id)) throw new Error(`Duplicate worker session: ${session.id}`);
        records.set(session.id, structuredClone(session));
      },
      get: (id) => clone(records.get(id)),
      getForJob: (jobId) => clone([...records.values()].find((session) => session.jobId === jobId)),
      setHarnessSession: (id, harnessSessionId, harnessSessionPath) => {
        const session = records.get(id);
        if (session) Object.assign(session, { harnessSessionId, harnessSessionPath });
      },
    });
  }

  create(session: WorkerSession): void { this.persistence.create(session); }
  get(id: string): WorkerSession | undefined { return this.persistence.get(id); }
  getForJob(jobId: string): WorkerSession | undefined { return this.persistence.getForJob(jobId); }
  setHarnessSession(id: string, harnessSessionId: string, harnessSessionPath: string | null): void {
    this.persistence.setHarnessSession(id, harnessSessionId, harnessSessionPath);
  }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
