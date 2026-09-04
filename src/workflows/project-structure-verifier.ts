import { ProjectCollectionPaths, type ProjectCollection } from "../domain/project-collection-paths.ts";
import type { Project } from "../domain/project.ts";
import { FileSystem } from "../infrastructure/filesystem/file-system.ts";
import { ManagedProjectStructure } from "../infrastructure/filesystem/managed-project-structure.ts";
import { Registry } from "../storage/registry.ts";

export interface ProjectStructureVerification {
  dataRoot: string;
  projectsRoot: string;
  roots: Record<ProjectCollection, string>;
  projects: Project[];
}

/** INFRASTRUCTURE_CONSUMER: verifies all structured bridges into policy-owned project directories. */
export class ProjectStructureVerifier {
  constructor(private readonly registry: Registry, private readonly structure: ManagedProjectStructure) {}

  static create(dataRoot: string, registry: Registry): ProjectStructureVerifier {
    const paths = new ProjectCollectionPaths(dataRoot);
    return new ProjectStructureVerifier(registry, ManagedProjectStructure.create(paths, FileSystem.create()));
  }

  verify(): ProjectStructureVerification {
    const snapshot = this.structure.inspect();
    const errors: string[] = [];
    const misplaced = snapshot.entries.filter((entry) => entry.kind !== "directory");
    if (misplaced.length) {
      errors.push(`Project collection entries must be directories: ${misplaced.map(label).join(", ")}`);
    }
    const directories = snapshot.entries.filter((entry) => entry.kind === "directory");
    const missingSequence = directories.filter((entry) => !entry.hasSequenceFile);
    if (missingSequence.length) errors.push(`Project directories missing a regular sequence.md: ${missingSequence.map(label).join(", ")}`);

    const duplicateNames = [...new Set(directories.map((entry) => entry.name))]
      .filter((name) => directories.filter((entry) => entry.name === name).length > 1);
    if (duplicateNames.length) errors.push(`Project directory names occur in multiple collections: ${duplicateNames.join(", ")}`);

    const projects = this.registry.projects.list();
    const byName = new Map(projects.map((project) => [project.directoryName, project]));
    const unregistered = directories.filter((entry) => !byName.has(entry.name));
    if (unregistered.length) errors.push(`Project directories are not registered: ${unregistered.map(label).join(", ")}`);

    const wrongCollection = directories.filter((entry) => {
      const project = byName.get(entry.name);
      return project && project.collection !== entry.collection;
    });
    if (wrongCollection.length) errors.push(`Project directories are in the wrong collection: ${wrongCollection.map((entry) => `${label(entry)} registered as ${byName.get(entry.name)!.collection}`).join(", ")}`);

    const directoryKeys = new Set(directories.map((entry) => `${entry.collection}:${entry.name}`));
    const missingDirectories = projects.filter((project) => !directoryKeys.has(`${project.collection}:${project.directoryName}`));
    if (missingDirectories.length) errors.push(`Registered projects have no directory: ${missingDirectories.map((project) => `${project.collection}/${project.directoryName}`).join(", ")}`);
    if (!directories.some((entry) => entry.collection === "active")) errors.push("No project directories found under DATA_ROOT/projects");

    if (errors.length) throw new Error(`Project structure verification failed:\n- ${errors.join("\n- ")}`);
    return {
      dataRoot: snapshot.dataRoot,
      projectsRoot: snapshot.roots.active,
      roots: snapshot.roots,
      projects: directories.map((entry) => byName.get(entry.name)!),
    };
  }
}

function label(entry: { collection: ProjectCollection; name: string; kind?: string }): string {
  const suffix = entry.kind && entry.kind !== "directory" ? ` (${entry.kind})` : "";
  return `${entry.collection}/${entry.name}${suffix}`;
}
