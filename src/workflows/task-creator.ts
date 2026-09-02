import type { Id } from "../domain/id.ts";
import type { Project } from "../domain/project.ts";
import type { Task } from "../domain/task.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";

export interface CreateTaskInput {
  workspaceId: string;
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
    private readonly ids: Pick<Id, "createTaskId">,
    private readonly clock: Clock,
  ) {}

  static create(
    registry: Registry,
    taskStore: TaskStore,
    ids: Pick<Id, "createTaskId">,
  ): TaskCreator {
    return new TaskCreator(registry, taskStore, ids, Clock.create());
  }

  async create(input: CreateTaskInput): Promise<CreatedTask> {
    const timestamp = this.clock.now();
    const project = this.registry.projects.get(input.workspaceId);
    if (!project?.authorizedAt) throw new Error(`Workspace is not authorized: ${input.workspaceId}`);
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
      this.registry.projects.touch(project.id, timestamp);
      this.registry.tasks.create(task);
    });

    return { project: { ...project, lastUsedAt: timestamp }, task };
  }
}
