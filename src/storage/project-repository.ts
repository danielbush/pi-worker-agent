import type { Project } from "../domain/project.ts";
import type { RegistryDatabase } from "./registry-database.ts";

/** Persists metadata for the architecture's `projects` table. */
export class ProjectRepository {
  constructor(private readonly database: RegistryDatabase) {}

  create(project: Project): void {
    this.database.db.query(`
      INSERT INTO projects (id, name, rootDir, createdAt, lastUsedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(project.id, project.name, project.rootDir, project.createdAt, project.lastUsedAt);
  }

  get(id: string): Project | undefined {
    return (this.database.db.query("SELECT * FROM projects WHERE id = ?").get(id) as Project | null) ?? undefined;
  }

  list(): Project[] {
    return this.database.db.query("SELECT * FROM projects ORDER BY lastUsedAt DESC").all() as Project[];
  }

  touch(id: string, lastUsedAt: string): void {
    this.database.db.query("UPDATE projects SET lastUsedAt = ? WHERE id = ?").run(lastUsedAt, id);
  }
}
