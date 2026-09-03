import type { Id } from "../domain/id.ts";
import type { Workspace } from "../domain/workspace.ts";
import type { Task } from "../domain/task.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";

export interface CreateTaskInput {
  workspaceId: string;
  projectId: string;
  title: string;
  intent?: string;
  outcomes?: string;
  background: string;
  profileOverrides?: Record<string, string>;
}
export interface CreatedTask { projectId: string; workspace: Workspace; task: Task; }

/** INFRASTRUCTURE_CONSUMER: creates a durable task and its relational agent-profile overrides. */
export class TaskCreator {
  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly ids: Pick<Id, "createTaskId">,
    private readonly clock: Clock,
  ) {}

  static create(registry: Registry, taskStore: TaskStore, ids: Pick<Id, "createTaskId">): TaskCreator {
    return new TaskCreator(registry, taskStore, ids, Clock.create());
  }

  async create(input: CreateTaskInput): Promise<CreatedTask> {
    const timestamp = this.clock.now();
    const workspace = this.registry.workspaces.resolve(input.workspaceId);
    if (!workspace?.authorizedAt) throw new Error(`Workspace is not authorized: ${input.workspaceId}`);
    const project = this.registry.projects.resolve(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    if (!this.registry.jobTypes.list().some((jobType) => !jobType.retired)) {
      throw new Error("Execution configuration has no active job types");
    }
    const overrides = Object.entries(input.profileOverrides ?? {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [jobTypeId, agentProfileId] of overrides) {
      const jobType = this.registry.jobTypes.get(jobTypeId);
      if (!jobType || jobType.retired) throw new Error(`Unknown or retired job type override: ${jobTypeId}`);
      const profile = this.registry.agentProfiles.get(agentProfileId);
      if (!profile || profile.retired) throw new Error(`Unknown or retired agent profile for ${jobTypeId}: ${agentProfileId}`);
    }
    const task: Task = {
      id: this.ids.createTaskId(), workspaceId: workspace.id, title: input.title,
      status: "queued", createdAt: timestamp, finishedAt: null,
    };

    await this.taskStore.tasks.create({ taskId: task.id, intent: input.intent, outcomes: input.outcomes, background: input.background });
    this.registry.transaction(() => {
      this.registry.workspaces.touch(workspace.id, timestamp);
      this.registry.projects.touch(project.id, timestamp);
      this.registry.tasks.create(task);
      this.registry.projectTasks.create({ projectId: project.id, taskId: task.id, addedAt: timestamp });
      for (const [jobTypeId, agentProfileId] of overrides) {
        this.registry.taskAgentProfileOverrides.set({ taskId: task.id, jobTypeId, agentProfileId });
      }
    });
    return { projectId: project.id, workspace: { ...workspace, lastUsedAt: timestamp }, task };
  }
}
