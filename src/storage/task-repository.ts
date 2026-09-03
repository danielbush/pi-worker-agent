import { resolveIdReference } from "../domain/id.ts";
import type { Task, TaskStatus } from "../domain/task.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface TaskPersistence {
  create(task: Task): void;
  get(id: string): Task | undefined;
  list(): Task[];
  listForWorkspace(workspaceId: string): Task[];
  updateStatus(id: string, status: TaskStatus, finishedAt: string | null): void;
}

/** INFRASTRUCTURE_CONSUMER: persists projections in the `tasks` table. */
export class TaskRepository {
  constructor(private readonly persistence: TaskPersistence) {}

  static create(database: RegistryDatabase): TaskRepository {
    return new TaskRepository({
      create: (task) => { database.db.query(`
        INSERT INTO tasks (id, workspaceId, title, status, createdAt, finishedAt) VALUES (?, ?, ?, ?, ?, ?)
      `).run(task.id, task.workspaceId, task.title, task.status, task.createdAt, task.finishedAt); },
      get: (id) => database.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined,
      list: () => database.db.query("SELECT * FROM tasks ORDER BY createdAt DESC").all() as Task[],
      listForWorkspace: (workspaceId) => database.db.query(`SELECT * FROM tasks WHERE workspaceId = ? ORDER BY createdAt DESC`).all(workspaceId) as Task[],
      updateStatus: (id, status, finishedAt) => { database.db.query("UPDATE tasks SET status = ?, finishedAt = ? WHERE id = ?").run(status, finishedAt, id); },
    });
  }

  static createNull(tasks: Task[] = []): TaskRepository {
    const records = new Map(tasks.map((task) => [task.id, structuredClone(task)]));
    return new TaskRepository({
      create: (task) => {
        if (records.has(task.id)) throw new Error(`Duplicate task: ${task.id}`);
        records.set(task.id, structuredClone(task));
      },
      get: (id) => clone(records.get(id)),
      list: () => [...records.values()].map((task) => structuredClone(task))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      listForWorkspace: (workspaceId) => [...records.values()].filter((task) => task.workspaceId === workspaceId)
        .map((task) => structuredClone(task)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      updateStatus: (id, status, finishedAt) => { const task = records.get(id); if (task) Object.assign(task, { status, finishedAt }); },
    });
  }

  create(task: Task): void { this.persistence.create(task); }
  get(id: string): Task | undefined { return this.persistence.get(id); }
  resolve(reference: string): Task | undefined {
    return resolveIdReference(reference, this.persistence.list(), "task");
  }
  list(): Task[] { return this.persistence.list(); }
  listForWorkspace(workspaceId: string): Task[] { return this.persistence.listForWorkspace(workspaceId); }
  updateStatus(id: string, status: TaskStatus, finishedAt: string | null = null): void {
    this.persistence.updateStatus(id, status, finishedAt);
  }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
