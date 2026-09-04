import { ProjectCollectionPaths } from "../domain/project-collection-paths.ts";
import { FileSystem } from "../infrastructure/filesystem/file-system.ts";

/** INFRASTRUCTURE_CONSUMER: validates manager policy roots and lists immediate active project directories. */
export class ManagedProjectCatalog {
  constructor(private readonly paths: ProjectCollectionPaths, private readonly fileSystem: FileSystem) {}

  static create(paths: ProjectCollectionPaths, fileSystem: FileSystem): ManagedProjectCatalog {
    return new ManagedProjectCatalog(paths, fileSystem);
  }

  static createNull(
    projectDirectories: string[] = [],
    paths = new ProjectCollectionPaths("/null-worker-agent"),
  ): ManagedProjectCatalog {
    return new ManagedProjectCatalog(paths, FileSystem.createNull({
      directories: [paths.dataRoot, paths.activeRoot, ...projectDirectories.map((name) => paths.projectPath("active", name))],
      files: [paths.policyFile],
    }));
  }

  /** Returns the data root and immediate active project directory names. */
  inspect(): { dataRoot: string; projectDirectories: string[] } {
    this.requireKind(this.paths.dataRoot, "directory", "DATA_ROOT");
    this.requireKind(this.paths.policyFile, "file", "PROJECT.md");
    this.requireKind(this.paths.activeRoot, "directory", "DATA_ROOT/projects");
    const projectDirectories = this.fileSystem.entries(this.paths.activeRoot)
      .filter((entry) => entry.kind === "directory" && !this.paths.isReservedCollectionDirectory(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    return { dataRoot: this.paths.dataRoot, projectDirectories };
  }

  private requireKind(path: string, expected: "directory" | "file", label: string): void {
    if (this.fileSystem.kind(path) !== expected) {
      throw new Error(`${label} is missing or is not a ${expected}: ${path}`);
    }
  }
}
