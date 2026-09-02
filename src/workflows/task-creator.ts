import type { Id } from "../domain/id.ts";
import type { Workspace } from "../domain/workspace.ts";
import { capabilityForPurpose } from "../domain/execution-profile.ts";
import type { Task } from "../domain/task.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import type { WorkflowProfileLoader } from "./workflow-profiles.ts";

export interface CreateTaskInput {
  workspaceId: string;
  projectId: string;
  title: string;
  intent?: string;
  outcomes?: string;
  background: string;
  profileOverrides?: Record<string, string>;
}

export interface CreatedTask {
  projectId: string;
  workspace: Workspace;
  task: Task;
}

/** INFRASTRUCTURE_CONSUMER: creates a durable task against a registered workspace. */
export class TaskCreator {
  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly ids: Pick<Id, "createTaskId">,
    private readonly clock: Clock,
    private readonly profiles: WorkflowProfileLoader,
  ) {}

  static create(
    registry: Registry,
    taskStore: TaskStore,
    ids: Pick<Id, "createTaskId">,
    profiles: WorkflowProfileLoader,
  ): TaskCreator {
    return new TaskCreator(registry, taskStore, ids, Clock.create(), profiles);
  }

  async create(input: CreateTaskInput): Promise<CreatedTask> {
    const timestamp = this.clock.now();
    const workspace = this.registry.workspaces.resolve(input.workspaceId);
    if (!workspace?.authorizedAt) throw new Error(`Workspace is not authorized: ${input.workspaceId}`);
    const project = this.registry.projects.resolve(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    const overrides = input.profileOverrides ?? {};
    // Policy compilation is mandatory even when this task has no overrides.
    const policy = this.profiles.load();
    for (const [purpose, profile] of Object.entries(overrides)) {
      capabilityForPurpose(purpose);
      if (!policy.profiles[profile]) throw new Error(`Unknown worker profile for ${purpose}: ${profile}`);
    }
    const task: Task = {
      id: this.ids.createTaskId(),
      workspaceId: workspace.id,
      title: input.title,
      status: "queued",
      createdAt: timestamp,
      finishedAt: null,
      profileOverrides: Object.keys(overrides).length
        ? JSON.stringify(Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))))
        : null,
    };

    await this.taskStore.tasks.create({
      taskId: task.id,
      intent: input.intent,
      outcomes: input.outcomes,
      background: input.background,
    });
    this.registry.transaction(() => {
      this.registry.workspaces.touch(workspace.id, timestamp);
      this.registry.projects.touch(project.id, timestamp);
      this.registry.tasks.create(task);
      this.registry.projectTasks.create({ projectId: project.id, taskId: task.id, addedAt: timestamp });
    });

    return { projectId: project.id, workspace: { ...workspace, lastUsedAt: timestamp }, task };
  }
}
