import { join } from "node:path";
import { ProjectCollectionPaths, type ProjectCollection } from "../domain/project-collection-paths.ts";
import { FileSystem, type FileKind, type NullFileSystemState } from "../infrastructure/filesystem/file-system.ts";

export type ManagedProjectEntryKind = Exclude<FileKind, "missing">;

export interface ManagedProjectStructureEntry {
  collection: ProjectCollection;
  name: string;
  kind: ManagedProjectEntryKind;
  hasSequenceFile: boolean;
}

export interface ManagedProjectStructureSnapshot {
  dataRoot: string;
  roots: Record<ProjectCollection, string>;
  entries: ManagedProjectStructureEntry[];
}

/** INFRASTRUCTURE_CONSUMER: inventories active, test, and archive project collections. */
export class ManagedProjectStructure {
  constructor(private readonly paths: ProjectCollectionPaths, private readonly fileSystem: FileSystem) {}

  static create(paths: ProjectCollectionPaths, fileSystem: FileSystem): ManagedProjectStructure {
    return new ManagedProjectStructure(paths, fileSystem);
  }

  static createNull(
    entries: Array<Omit<ManagedProjectStructureEntry, "collection"> & { collection?: ProjectCollection }> = [],
    dataRoot = "/null-worker-agent",
  ): ManagedProjectStructure {
    const paths = new ProjectCollectionPaths(dataRoot);
    const normalized = entries.map((entry) => ({ ...entry, collection: entry.collection ?? "active" as const }));
    const state: NullFileSystemState = {
      directories: [paths.dataRoot, paths.activeRoot],
      files: [paths.policyFile],
      symbolicLinks: [],
      other: [],
    };
    for (const entry of normalized) {
      const path = paths.projectPath(entry.collection, entry.name);
      if (entry.kind === "directory") state.directories!.push(path);
      else if (entry.kind === "file") state.files!.push(path);
      else if (entry.kind === "symbolic-link") state.symbolicLinks!.push(path);
      else state.other!.push(path);
      if (entry.hasSequenceFile) state.files!.push(join(path, "sequence.md"));
    }
    return new ManagedProjectStructure(paths, FileSystem.createNull(state));
  }

  inspect(): ManagedProjectStructureSnapshot {
    this.requireKind(this.paths.dataRoot, "directory", "DATA_ROOT");
    this.requireKind(this.paths.policyFile, "file", "PROJECT.md");
    this.requireKind(this.paths.activeRoot, "directory", "DATA_ROOT/projects");
    const roots = this.roots();
    const entries = (["active", "test", "archive"] as const).flatMap((collection) =>
      this.inspectCollection(roots[collection], collection, collection === "active"),
    );
    return { dataRoot: this.paths.dataRoot, roots, entries };
  }

  private inspectCollection(root: string, collection: ProjectCollection, required: boolean): ManagedProjectStructureEntry[] {
    const rootKind = this.fileSystem.entryKind(root);
    if (rootKind === "missing" && !required) return [];
    if (rootKind !== "directory") throw new Error(`Project collection ${collection} root is not a regular directory: ${root}`);
    return this.fileSystem.entries(root)
      .filter((entry) => collection !== "active" || !this.paths.isReservedCollectionDirectory(entry.name))
      .map((entry) => ({
        collection,
        name: entry.name,
        kind: entry.kind,
        hasSequenceFile: entry.kind === "directory" && this.fileSystem.entryKind(join(root, entry.name, "sequence.md")) === "file",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private roots(): Record<ProjectCollection, string> {
    return { active: this.paths.activeRoot, test: this.paths.testRoot, archive: this.paths.archiveRoot };
  }

  private requireKind(path: string, expected: "directory" | "file", label: string): void {
    if (this.fileSystem.kind(path) !== expected) throw new Error(`${label} is missing or is not a ${expected}: ${path}`);
  }
}
