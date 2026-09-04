import type { ProjectTask } from "../domain/project-task.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";

/** INFRASTRUCTURE_CONSUMER: adds existing tasks to management projects. */
export class ProjectTaskLinker {
  constructor(private readonly registry: Registry, private readonly clock: Clock) {}

  static create(registry: Registry): ProjectTaskLinker {
    return new ProjectTaskLinker(registry, Clock.create());
  }

  link(projectReference: string, taskReference: string): ProjectTask {
    const project = this.registry.projects.resolve(projectReference);
    if (!project) throw new Error(`Unknown project: ${projectReference}`);
    if (project.collection === "archive") throw new Error(`Archived projects are read-only: ${project.directoryName}`);
    const task = this.registry.tasks.resolve(taskReference);
    if (!task) throw new Error(`Unknown task: ${taskReference}`);
    const association = { projectId: project.id, taskId: task.id, addedAt: this.clock.now() };
    this.registry.projectTasks.create(association);
    return association;
  }
}
