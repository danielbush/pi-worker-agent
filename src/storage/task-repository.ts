import type { Task, TaskStatus } from "../domain/task.ts";
import type { RegistryDatabase } from "./registry-database.ts";

/** Persists metadata and current-state projections for the `tasks` table. */
export class TaskRepository {
  constructor(private readonly database: RegistryDatabase) {}

  create(task: Task): void {
    this.database.db.query(`
      INSERT INTO tasks (id, projectId, title, status, createdAt, finishedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(task.id, task.projectId, task.title, task.status, task.createdAt, task.finishedAt);
  }

  get(id: string): Task | undefined {
    return (this.database.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | null) ?? undefined;
  }

  listForProject(projectId: string): Task[] {
    return this.database.db.query(`
      SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt DESC
    `).all(projectId) as Task[];
  }

  updateStatus(id: string, status: TaskStatus, finishedAt: string | null = null): void {
    this.database.db.query("UPDATE tasks SET status = ?, finishedAt = ? WHERE id = ?").run(status, finishedAt, id);
  }
}
