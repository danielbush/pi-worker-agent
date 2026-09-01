import type { Project } from "../domain/project.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface ProjectPersistence {
  create(project: Project): void;
  get(id: string): Project | undefined;
  list(): Project[];
  touch(id: string, lastUsedAt: string): void;
}

/** INFRASTRUCTURE_CONSUMER: persists registered-project metadata in `workspaces`. */
export class ProjectRepository {
  constructor(private readonly persistence: ProjectPersistence) {}

  static create(database: RegistryDatabase): ProjectRepository {
    return new ProjectRepository({
      create: (project) => database.db.query(`
        INSERT INTO workspaces (id, name, rootDir, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?)
      `).run(project.id, project.name, project.rootDir, project.createdAt, project.lastUsedAt),
      get: (id) => (database.db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as Project | null) ?? undefined,
      list: () => database.db.query("SELECT * FROM workspaces ORDER BY lastUsedAt DESC").all() as Project[],
      touch: (id, lastUsedAt) => { database.db.query("UPDATE workspaces SET lastUsedAt = ? WHERE id = ?").run(lastUsedAt, id); },
    });
  }

  static createNull(projects: Project[] = []): ProjectRepository {
    const records = new Map(projects.map((project) => [project.id, structuredClone(project)]));
    return new ProjectRepository({
      create: (project) => {
        if (records.has(project.id)) throw new Error(`Duplicate project: ${project.id}`);
        records.set(project.id, structuredClone(project));
      },
      get: (id) => clone(records.get(id)),
      list: () => [...records.values()].map((project) => structuredClone(project))
        .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
      touch: (id, lastUsedAt) => { const project = records.get(id); if (project) project.lastUsedAt = lastUsedAt; },
    });
  }

  create(project: Project): void { this.persistence.create(project); }
  get(id: string): Project | undefined { return this.persistence.get(id); }
  list(): Project[] { return this.persistence.list(); }
  touch(id: string, lastUsedAt: string): void { this.persistence.touch(id, lastUsedAt); }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
