import type { Project } from "../domain/project.ts";
import { ManagedProjectMover } from "../infrastructure/filesystem/managed-project-mover.ts";
import { Registry } from "../storage/registry.ts";

/** INFRASTRUCTURE_CONSUMER: moves an active project to the archive collection while preserving identity. */
export class ProjectArchiver {
  constructor(private readonly registry: Registry, private readonly mover: ManagedProjectMover) {}

  static create(dataRoot: string, registry: Registry): ProjectArchiver {
    return new ProjectArchiver(registry, ManagedProjectMover.create(dataRoot));
  }

  archive(reference: string): Project {
    const project = this.registry.projects.getByDirectoryName(reference) ?? this.registry.projects.resolve(reference);
    if (!project) throw new Error(`Unknown project: ${reference}`);
    if (project.collection !== "active") throw new Error(`Only active projects can be archived: ${project.directoryName}`);
    const outstanding = this.registry.projectTasks.listTasks(project.id).filter((task) => task.status === "queued" || task.status === "running");
    if (outstanding.length) throw new Error(`Cannot archive project with outstanding tasks: ${outstanding.map((task) => task.id).join(", ")}`);
    this.mover.move(project.directoryName, "active", "archive");
    try {
      this.registry.projects.updateCollection(project.id, "archive");
    } catch (error) {
      this.mover.move(project.directoryName, "archive", "active");
      throw error;
    }
    return { ...project, collection: "archive" };
  }
}
