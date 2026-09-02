import type { ProjectTask } from "../domain/project-task.ts";
import type { Task } from "../domain/task.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface ProjectTaskPersistence {
  create(association: ProjectTask): void;
  listTasks(projectId: string): Task[];
}

/** INFRASTRUCTURE_CONSUMER: owns project-to-task associations and joined task queries. */
export class ProjectTaskRepository {
  constructor(private readonly persistence: ProjectTaskPersistence) {}

  static create(database: RegistryDatabase): ProjectTaskRepository {
    return new ProjectTaskRepository({
      create: (association) => database.db.query(`
        INSERT INTO projects_tasks (projectId, taskId, addedAt) VALUES (?, ?, ?)
      `).run(association.projectId, association.taskId, association.addedAt),
      listTasks: (projectId) => database.db.query(`
        SELECT tasks.* FROM projects_tasks
        JOIN tasks ON tasks.id = projects_tasks.taskId
        WHERE projects_tasks.projectId = ?
        ORDER BY tasks.createdAt DESC
      `).all(projectId) as Task[],
    });
  }

  static createNull(
    associations: ProjectTask[] = [],
    getTask: (taskId: string) => Task | undefined = () => undefined,
  ): ProjectTaskRepository {
    const records = associations.map((association) => structuredClone(association));
    return new ProjectTaskRepository({
      create: (association) => {
        if (records.some((entry) => entry.projectId === association.projectId && entry.taskId === association.taskId)) {
          throw new Error(`Task is already associated with project: ${association.taskId}`);
        }
        records.push(structuredClone(association));
      },
      listTasks: (projectId) => records
        .filter((association) => association.projectId === projectId)
        .flatMap((association) => {
          const task = getTask(association.taskId);
          return task ? [structuredClone(task)] : [];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  }

  create(association: ProjectTask): void { this.persistence.create(association); }
  listTasks(projectId: string): Task[] { return this.persistence.listTasks(projectId); }
}
