import { resolveIdReference } from "../domain/id.ts";
import type { Workspace } from "../domain/workspace.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface WorkspacePersistence {
  create(workspace: Workspace): void;
  get(id: string): Workspace | undefined;
  list(): Workspace[];
  touch(id: string, lastUsedAt: string): void;
  authorize(id: string, authorizedAt: string, authorizedBySessionId: string): void;
}

/** INFRASTRUCTURE_CONSUMER: persists authorized execution locations. */
export class WorkspaceRepository {
  constructor(private readonly persistence: WorkspacePersistence) {}

  static create(database: RegistryDatabase): WorkspaceRepository {
    return new WorkspaceRepository({
      create: (workspace) => database.db.query(`
        INSERT INTO workspaces (id, name, rootDir, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?)
      `).run(workspace.id, workspace.name, workspace.rootDir, workspace.createdAt, workspace.lastUsedAt),
      get: (id) => (database.db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as Workspace | null) ?? undefined,
      list: () => database.db.query("SELECT * FROM workspaces ORDER BY lastUsedAt DESC").all() as Workspace[],
      touch: (id, lastUsedAt) => { database.db.query("UPDATE workspaces SET lastUsedAt = ? WHERE id = ?").run(lastUsedAt, id); },
      authorize: (id, authorizedAt, authorizedBySessionId) => {
        database.db.query(`
          UPDATE workspaces SET authorizedAt = ?, authorizedBySessionId = ?, lastUsedAt = ? WHERE id = ?
        `).run(authorizedAt, authorizedBySessionId, authorizedAt, id);
      },
    });
  }

  static createNull(workspaces: Workspace[] = []): WorkspaceRepository {
    const records = new Map(workspaces.map((workspace) => [workspace.id, structuredClone(workspace)]));
    return new WorkspaceRepository({
      create: (workspace) => {
        if (records.has(workspace.id)) throw new Error(`Duplicate workspace: ${workspace.id}`);
        records.set(workspace.id, structuredClone(workspace));
      },
      get: (id) => clone(records.get(id)),
      list: () => [...records.values()].map((project) => structuredClone(project))
        .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
      touch: (id, lastUsedAt) => { const project = records.get(id); if (project) project.lastUsedAt = lastUsedAt; },
      authorize: (id, authorizedAt, authorizedBySessionId) => {
        const project = records.get(id);
        if (project) {
          project.authorizedAt = authorizedAt;
          project.authorizedBySessionId = authorizedBySessionId;
          project.lastUsedAt = authorizedAt;
        }
      },
    });
  }

  create(workspace: Workspace): void { this.persistence.create(workspace); }
  get(id: string): Workspace | undefined { return this.persistence.get(id); }
  resolve(reference: string): Workspace | undefined {
    return resolveIdReference(reference, this.list(), "workspace");
  }
  list(): Workspace[] { return this.persistence.list(); }
  touch(id: string, lastUsedAt: string): void { this.persistence.touch(id, lastUsedAt); }
  authorize(id: string, authorizedAt: string, authorizedBySessionId: string): void {
    this.persistence.authorize(id, authorizedAt, authorizedBySessionId);
  }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
