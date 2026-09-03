import type { Project } from "../domain/project.ts";
import { ManagedProjectStructure } from "../infrastructure/filesystem/managed-project-structure.ts";
import { Registry } from "../storage/registry.ts";

export interface ProjectStructureVerification {
  dataRoot: string;
  projectsRoot: string;
  projects: Project[];
}

/** INFRASTRUCTURE_CONSUMER: verifies the structured bridge into policy-owned project directories. */
export class ProjectStructureVerifier {
  constructor(private readonly registry: Registry, private readonly structure: ManagedProjectStructure) {}

  static create(dataRoot: string, registry: Registry): ProjectStructureVerifier {
    return new ProjectStructureVerifier(registry, ManagedProjectStructure.create(dataRoot));
  }

  verify(): ProjectStructureVerification {
    const snapshot = this.structure.inspect();
    const errors: string[] = [];
    const misplaced = snapshot.entries.filter((entry) => entry.kind !== "directory");
    if (misplaced.length) {
      errors.push(`DATA_ROOT/projects entries must be directories: ${misplaced.map((entry) => `${entry.name} (${entry.kind})`).join(", ")}`);
    }
    const directories = snapshot.entries.filter((entry) => entry.kind === "directory");
    const missingSequence = directories.filter((entry) => !entry.hasSequenceFile);
    if (missingSequence.length) {
      errors.push(`Project directories missing a regular sequence.md: ${missingSequence.map((entry) => entry.name).join(", ")}`);
    }

    const projects = this.registry.projects.list();
    const registeredNames = new Set(projects.map((project) => project.directoryName));
    const directoryNames = new Set(directories.map((entry) => entry.name));
    const unregistered = directories.filter((entry) => !registeredNames.has(entry.name));
    if (unregistered.length) {
      errors.push(`Project directories are not registered: ${unregistered.map((entry) => entry.name).join(", ")}`);
    }
    const missingDirectories = projects.filter((project) => !directoryNames.has(project.directoryName));
    if (missingDirectories.length) {
      errors.push(`Registered projects have no directory: ${missingDirectories.map((project) => project.directoryName).join(", ")}`);
    }
    if (!directories.length) errors.push("No project directories found under DATA_ROOT/projects");

    if (errors.length) {
      throw new Error(`Project structure verification failed:\n- ${errors.join("\n- ")}`);
    }
    return {
      dataRoot: snapshot.dataRoot,
      projectsRoot: snapshot.projectsRoot,
      projects: directories.map((entry) => projects.find((project) => project.directoryName === entry.name)!),
    };
  }
}
