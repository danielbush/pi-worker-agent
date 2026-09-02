import type { Id } from "../domain/id.ts";
import type { Project } from "../domain/project.ts";
import type { Task } from "../domain/task.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";

export interface CreateTaskInput {
  workspaceRoot: string;
  workspaceName: string;
  title: string;
  intent?: string;
  outcomes?: string;
  background: string;
}

export interface CreatedTask {
  project: Project;
  task: Task;
}

/** INFRASTRUCTURE_CONSUMER: creates a durable task against a registered workspace. */
export class TaskCreator {
  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly ids: Pick<Id, "createProjectId" | "createTaskId">,
    private readonly clock: Clock,
  ) {}

  static create(
    registry: Registry,
    taskStore: TaskStore,
    ids: Pick<Id, "createProjectId" | "createTaskId">,
  ): TaskCreator {
    return new TaskCreator(registry, taskStore, ids, Clock.create());
  }

  async create(input: CreateTaskInput): Promise<CreatedTask> {
    const timestamp = this.clock.now();
    const existing = this.registry.projects.list().find(
      (project) => project.rootDir === input.workspaceRoot,
    );
    const project: Project = existing ?? {
      id: this.ids.createProjectId(),
      name: input.workspaceName,
      rootDir: input.workspaceRoot,
      createdAt: timestamp,
      lastUsedAt: timestamp,
    };
    const task: Task = {
      id: this.ids.createTaskId(),
      projectId: project.id,
      title: input.title,
      status: "queued",
      createdAt: timestamp,
      finishedAt: null,
    };

    await this.taskStore.tasks.create({
      taskId: task.id,
      intent: input.intent,
      outcomes: input.outcomes,
      background: input.background,
    });
    this.registry.transaction(() => {
      if (existing) this.registry.projects.touch(project.id, timestamp);
      else this.registry.projects.create(project);
      this.registry.tasks.create(task);
    });

    return { project: { ...project, lastUsedAt: timestamp }, task };
  }
}
