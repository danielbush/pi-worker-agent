import type { Project } from "../domain/project.ts";
import type { RegistryDatabase } from "./registry-database.ts";

/** INFRASTRUCTURE_CONSUMER: persists metadata in the `projects` table. */
export class ProjectRepository {
  private constructor(
    private readonly database: RegistryDatabase | undefined,
    private readonly records: Map<string, Project> | undefined,
  ) {}

  static create(database: RegistryDatabase): ProjectRepository {
    return new ProjectRepository(database, undefined);
  }

  static createNull(projects: Project[] = []): ProjectRepository {
    return new ProjectRepository(undefined, new Map(projects.map((project) => [project.id, structuredClone(project)])));
  }

  create(project: Project): void {
    if (this.records) {
      if (this.records.has(project.id)) throw new Error(`Duplicate project: ${project.id}`);
      this.records.set(project.id, structuredClone(project));
      return;
    }
    this.database!.db.query(`
      INSERT INTO projects (id, name, rootDir, createdAt, lastUsedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(project.id, project.name, project.rootDir, project.createdAt, project.lastUsedAt);
  }

  get(id: string): Project | undefined {
    if (this.records) return clone(this.records.get(id));
    return (this.database!.db.query("SELECT * FROM projects WHERE id = ?").get(id) as Project | null) ?? undefined;
  }

  list(): Project[] {
    if (this.records) {
      return [...this.records.values()]
        .map((project) => structuredClone(project))
        .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
    }
    return this.database!.db.query("SELECT * FROM projects ORDER BY lastUsedAt DESC").all() as Project[];
  }

  touch(id: string, lastUsedAt: string): void {
    if (this.records) {
      const project = this.records.get(id);
      if (project) project.lastUsedAt = lastUsedAt;
      return;
    }
    this.database!.db.query("UPDATE projects SET lastUsedAt = ? WHERE id = ?").run(lastUsedAt, id);
  }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
