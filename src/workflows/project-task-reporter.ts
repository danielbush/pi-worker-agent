import type { Project } from "../domain/project.ts";
import type { Task } from "../domain/task.ts";
import { Registry } from "../storage/registry.ts";

export interface ProjectTaskReport {
  project: Project;
  tasks: Task[];
}

/** INFRASTRUCTURE_CONSUMER: answers project task-status questions through relational metadata. */
export class ProjectTaskReporter {
  constructor(private readonly registry: Registry) {}

  static create(registry: Registry): ProjectTaskReporter {
    return new ProjectTaskReporter(registry);
  }

  inspect(projectReference: string, outstandingOnly = false): ProjectTaskReport {
    const project = this.registry.projects.getByDirectoryName(projectReference)
      ?? this.registry.projects.resolve(projectReference);
    if (!project) throw new Error(`Unknown project: ${projectReference}`);
    const tasks = this.registry.projectTasks.listTasks(project.id).filter((task) => !outstandingOnly
      || (task.status !== "completed" && task.status !== "cancelled"));
    return { project, tasks };
  }
}
