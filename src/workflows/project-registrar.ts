import type { Id } from "../domain/id.ts";
import type { ProjectCollection } from "../domain/project-collection.ts";
import type { Project } from "../domain/project.ts";
import { ManagedProjectDirectory } from "../infrastructure/filesystem/managed-project-directory.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";

export interface RegisterProjectInput {
  directoryName: string;
  title: string;
  description?: string;
  collection?: Exclude<ProjectCollection, "archive">;
}

/** INFRASTRUCTURE_CONSUMER: indexes a management-project directory in durable metadata. */
export class ProjectRegistrar {
  constructor(
    private readonly registry: Registry,
    private readonly directories: ManagedProjectDirectory,
    private readonly ids: Pick<Id, "createProjectId">,
    private readonly clock: Clock,
  ) {}

  static create(root: string, registry: Registry, ids: Pick<Id, "createProjectId">): ProjectRegistrar {
    return new ProjectRegistrar(registry, ManagedProjectDirectory.create(root), ids, Clock.create());
  }

  register(input: RegisterProjectInput): Project {
    const collection = input.collection ?? "active";
    this.directories.require(input.directoryName, collection);
    const timestamp = this.clock.now();
    const existing = this.registry.projects.getByDirectoryName(input.directoryName);
    if (existing) {
      this.registry.projects.touch(existing.id, timestamp);
      return { ...existing, lastUsedAt: timestamp };
    }
    const project: Project = {
      id: this.ids.createProjectId(),
      collection,
      directoryName: input.directoryName,
      title: input.title,
      description: input.description ?? null,
      createdAt: timestamp,
      lastUsedAt: timestamp,
    };
    this.registry.projects.create(project);
    return project;
  }
}
