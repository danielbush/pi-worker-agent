import { ProjectCollectionPaths, type ProjectCollection } from "../domain/project-collection-paths.ts";
import { FileSystem } from "../infrastructure/filesystem/file-system.ts";

/** INFRASTRUCTURE_CONSUMER: moves one non-symlink project directory between configured collection roots. */
export class ManagedProjectMover {
  constructor(private readonly paths: ProjectCollectionPaths, private readonly fileSystem: FileSystem) {}

  static create(paths: ProjectCollectionPaths, fileSystem: FileSystem): ManagedProjectMover {
    return new ManagedProjectMover(paths, fileSystem);
  }

  static createNull(
    projects: Array<{ collection: ProjectCollection; directoryName: string }> = [],
    paths = new ProjectCollectionPaths("/null-worker-agent"),
  ): ManagedProjectMover {
    return new ManagedProjectMover(paths, FileSystem.createNull({
      directories: projects.map((project) => paths.projectPath(project.collection, project.directoryName)),
    }));
  }

  move(directoryName: string, from: ProjectCollection, to: ProjectCollection): void {
    const source = this.paths.projectPath(from, directoryName);
    const destinationRoot = this.paths.rootFor(to);
    const destination = this.paths.projectPath(to, directoryName);
    const sourceKind = this.fileSystem.entryKind(source);
    if (sourceKind === "missing") throw new Error(`Project source does not exist: ${source}`);
    if (sourceKind !== "directory") throw new Error(`Project source is not a regular directory: ${source}`);
    if (this.fileSystem.entryKind(destination) !== "missing") throw new Error(`Project destination already exists: ${destination}`);
    this.fileSystem.createDirectory(destinationRoot);
    this.fileSystem.move(source, destination);
  }
}
