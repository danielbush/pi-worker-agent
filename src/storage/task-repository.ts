import type { Task, TaskStatus } from "../domain/task.ts";
import type { RegistryDatabase } from "./registry-database.ts";

/** INFRASTRUCTURE_CONSUMER: persists projections in the `tasks` table. */
export class TaskRepository {
  private constructor(
    private readonly database: RegistryDatabase | undefined,
    private readonly records: Map<string, Task> | undefined,
  ) {}

  static create(database: RegistryDatabase): TaskRepository {
    return new TaskRepository(database, undefined);
  }

  static createNull(tasks: Task[] = []): TaskRepository {
    return new TaskRepository(undefined, new Map(tasks.map((task) => [task.id, structuredClone(task)])));
  }

  create(task: Task): void {
    if (this.records) {
      if (this.records.has(task.id)) throw new Error(`Duplicate task: ${task.id}`);
      this.records.set(task.id, structuredClone(task));
      return;
    }
    this.database!.db.query(`
      INSERT INTO tasks (id, projectId, title, status, createdAt, finishedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(task.id, task.projectId, task.title, task.status, task.createdAt, task.finishedAt);
  }

  get(id: string): Task | undefined {
    if (this.records) return clone(this.records.get(id));
    return (this.database!.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | null) ?? undefined;
  }

  listForProject(projectId: string): Task[] {
    if (this.records) {
      return [...this.records.values()]
        .filter((task) => task.projectId === projectId)
        .map((task) => structuredClone(task))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return this.database!.db.query(`
      SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt DESC
    `).all(projectId) as Task[];
  }

  updateStatus(id: string, status: TaskStatus, finishedAt: string | null = null): void {
    if (this.records) {
      const task = this.records.get(id);
      if (task) Object.assign(task, { status, finishedAt });
      return;
    }
    this.database!.db.query("UPDATE tasks SET status = ?, finishedAt = ? WHERE id = ?").run(status, finishedAt, id);
  }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
