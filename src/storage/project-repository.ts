import { resolveIdReference } from "../domain/id.ts";
import type { Project } from "../domain/project.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface ProjectPersistence {
  create(project: Project): void;
  get(id: string): Project | undefined;
  getByDirectoryName(directoryName: string): Project | undefined;
  list(): Project[];
  touch(id: string, lastUsedAt: string): void;
}

/** INFRASTRUCTURE_CONSUMER: persists management-project identity and recovery metadata. */
export class ProjectRepository {
  constructor(private readonly persistence: ProjectPersistence) {}

  static create(database: RegistryDatabase): ProjectRepository {
    return new ProjectRepository({
      create: (project) => database.db.query(`
        INSERT INTO projects (id, directoryName, title, description, createdAt, lastUsedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(project.id, project.directoryName, project.title, project.description, project.createdAt, project.lastUsedAt),
      get: (id) => (database.db.query("SELECT * FROM projects WHERE id = ?").get(id) as Project | null) ?? undefined,
      getByDirectoryName: (name) => (database.db.query(
        "SELECT * FROM projects WHERE directoryName = ?",
      ).get(name) as Project | null) ?? undefined,
      list: () => database.db.query("SELECT * FROM projects ORDER BY lastUsedAt DESC").all() as Project[],
      touch: (id, lastUsedAt) => {
        database.db.query("UPDATE projects SET lastUsedAt = ? WHERE id = ?").run(lastUsedAt, id);
      },
    });
  }

  static createNull(projects: Project[] = []): ProjectRepository {
    const records = new Map(projects.map((project) => [project.id, structuredClone(project)]));
    return new ProjectRepository({
      create: (project) => {
        if ([...records.values()].some((entry) => entry.directoryName === project.directoryName)) {
          throw new Error(`Duplicate project directory: ${project.directoryName}`);
        }
        records.set(project.id, structuredClone(project));
      },
      get: (id) => clone(records.get(id)),
      getByDirectoryName: (name) => clone([...records.values()].find((project) => project.directoryName === name)),
      list: () => [...records.values()].map((project) => structuredClone(project)),
      touch: (id, lastUsedAt) => { const project = records.get(id); if (project) project.lastUsedAt = lastUsedAt; },
    });
  }

  create(project: Project): void { this.persistence.create(project); }
  get(id: string): Project | undefined { return this.persistence.get(id); }
  resolve(reference: string): Project | undefined {
    return resolveIdReference(reference, this.list(), "project");
  }
  getByDirectoryName(directoryName: string): Project | undefined {
    return this.persistence.getByDirectoryName(directoryName);
  }
  list(): Project[] { return this.persistence.list(); }
  touch(id: string, lastUsedAt: string): void { this.persistence.touch(id, lastUsedAt); }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
