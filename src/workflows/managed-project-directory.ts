import { join } from "node:path";
import { ProjectCollectionPaths, type ProjectCollection } from "../domain/project-collection-paths.ts";
import { FileSystem } from "../infrastructure/filesystem/file-system.ts";

/** INFRASTRUCTURE_CONSUMER: validates project identities against configured project collection paths. */
export class ManagedProjectDirectory {
  constructor(private readonly paths: ProjectCollectionPaths, private readonly fileSystem: FileSystem) {}

  static create(paths: ProjectCollectionPaths, fileSystem: FileSystem): ManagedProjectDirectory {
    return new ManagedProjectDirectory(paths, fileSystem);
  }

  static createNull(
    existing: Array<string | { collection: ProjectCollection; name: string }> = [],
    paths = new ProjectCollectionPaths("/null-worker-agent"),
  ): ManagedProjectDirectory {
    const projects = existing.map((entry) => typeof entry === "string" ? { collection: "active" as const, name: entry } : entry);
    return new ManagedProjectDirectory(paths, FileSystem.createNull({
      directories: projects.map((project) => paths.projectPath(project.collection, project.name)),
      files: projects.map((project) => join(paths.projectPath(project.collection, project.name), "sequence.md")),
    }));
  }

  require(directoryName: string, collection: ProjectCollection = "active"): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(directoryName)) {
      throw new Error(`Invalid project directory name: ${directoryName}`);
    }
    const directory = this.paths.projectPath(collection, directoryName);
    if (this.fileSystem.entryKind(directory) !== "directory" || this.fileSystem.entryKind(join(directory, "sequence.md")) !== "file") {
      throw new Error(`Managed-project directory does not exist: ${directoryName}`);
    }
  }
}
