import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectCollectionDirectory, type ProjectCollection } from "../../domain/project-collection.ts";

export type ManagedProjectEntryKind = "directory" | "file" | "symbolic-link" | "other";

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

interface ManagedProjectStructureDriver {
  inspect(dataRoot: string): ManagedProjectStructureSnapshot;
}

/** INFRASTRUCTURE_WRAPPER: inventories active, test, and archive project collections. */
export class ManagedProjectStructure {
  constructor(private readonly dataRoot: string, private readonly driver: ManagedProjectStructureDriver) {}

  static create(dataRoot: string): ManagedProjectStructure {
    return new ManagedProjectStructure(dataRoot, { inspect: productionSnapshot });
  }

  static createNull(
    entries: Array<Omit<ManagedProjectStructureEntry, "collection"> & { collection?: ProjectCollection }> = [],
    dataRoot = "/null-worker-agent",
  ): ManagedProjectStructure {
    return new ManagedProjectStructure(dataRoot, {
      inspect: (root) => ({
        dataRoot: root,
        roots: collectionRoots(root),
        entries: entries.map((entry) => ({ ...entry, collection: entry.collection ?? "active" })),
      }),
    });
  }

  inspect(): ManagedProjectStructureSnapshot { return this.driver.inspect(this.dataRoot); }
}

function productionSnapshot(dataRoot: string): ManagedProjectStructureSnapshot {
  requireDirectory(dataRoot, "DATA_ROOT");
  requireFile(join(dataRoot, "PROJECT.md"), "PROJECT.md");
  const roots = collectionRoots(dataRoot);
  requireDirectory(roots.active, "DATA_ROOT/projects");
  const entries = (["active", "test", "archive"] as const).flatMap((collection) =>
    inspectCollection(roots[collection], collection, collection === "active"),
  );
  return { dataRoot, roots, entries };
}

function collectionRoots(dataRoot: string): Record<ProjectCollection, string> {
  return {
    active: join(dataRoot, projectCollectionDirectory("active")),
    test: join(dataRoot, projectCollectionDirectory("test")),
    archive: join(dataRoot, projectCollectionDirectory("archive")),
  };
}

function inspectCollection(root: string, collection: ProjectCollection, required: boolean): ManagedProjectStructureEntry[] {
  try {
    if (!statSync(root).isDirectory()) throw new Error();
  } catch {
    if (required) throw new Error(`DATA_ROOT/${projectCollectionDirectory(collection)} is missing or is not a directory: ${root}`);
    return [];
  }
  return readdirSync(root, { withFileTypes: true }).map((entry) => {
    const kind: ManagedProjectEntryKind = entry.isDirectory()
      ? "directory"
      : entry.isFile()
        ? "file"
        : entry.isSymbolicLink()
          ? "symbolic-link"
          : "other";
    return {
      collection,
      name: entry.name,
      kind,
      hasSequenceFile: kind === "directory" && isRegularFile(join(root, entry.name, "sequence.md")),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function requireDirectory(path: string, label: string): void {
  try { if (statSync(path).isDirectory()) return; } catch {}
  throw new Error(`${label} is missing or is not a directory: ${path}`);
}

function requireFile(path: string, label: string): void {
  try { if (statSync(path).isFile()) return; } catch {}
  throw new Error(`${label} is missing or is not a file: ${path}`);
}

function isRegularFile(path: string): boolean {
  try { return lstatSync(path).isFile(); } catch { return false; }
}
