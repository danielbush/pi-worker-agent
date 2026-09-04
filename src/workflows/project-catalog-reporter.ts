import { ProjectCollectionPaths } from "../domain/project-collection-paths.ts";
import type { Project } from "../domain/project.ts";
import { FileSystem } from "../infrastructure/filesystem/file-system.ts";
import { ManagedProjectCatalog } from "./managed-project-catalog.ts";
import { Registry } from "../storage/registry.ts";

export interface ProjectCatalogReport {
  dataRoot: string;
  projects: Project[];
}

/** INFRASTRUCTURE_CONSUMER: validates and reports the manager's configured projects. */
export class ProjectCatalogReporter {
  constructor(private readonly registry: Registry, private readonly catalog: ManagedProjectCatalog) {}

  static create(dataRoot: string, registry: Registry): ProjectCatalogReporter {
    const paths = new ProjectCollectionPaths(dataRoot);
    return new ProjectCatalogReporter(registry, ManagedProjectCatalog.create(paths, FileSystem.create()));
  }

  inspect(): ProjectCatalogReport {
    const { dataRoot, projectDirectories } = this.catalog.inspect();
    if (!projectDirectories.length) throw new Error("No project directories found under DATA_ROOT/projects");
    const projects = this.registry.projects.list("active");
    const registered = new Set(projects.map((project) => project.directoryName));
    const directories = new Set(projectDirectories);
    const unregistered = projectDirectories.filter((name) => !registered.has(name));
    if (unregistered.length) throw new Error(`Project directories are not registered: ${unregistered.join(", ")}`);
    const missing = projects.filter((project) => !directories.has(project.directoryName));
    if (missing.length) throw new Error(`Registered active projects have no directory: ${missing.map((project) => project.directoryName).join(", ")}`);
    return {
      dataRoot,
      projects: projectDirectories.map((name) => projects.find((project) => project.directoryName === name)!),
    };
  }
}
