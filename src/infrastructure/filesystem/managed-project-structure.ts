import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type ManagedProjectEntryKind = "directory" | "file" | "symbolic-link" | "other";

export interface ManagedProjectStructureEntry {
  name: string;
  kind: ManagedProjectEntryKind;
  hasSequenceFile: boolean;
}

export interface ManagedProjectStructureSnapshot {
  dataRoot: string;
  projectsRoot: string;
  entries: ManagedProjectStructureEntry[];
}

interface ManagedProjectStructureDriver {
  inspect(dataRoot: string): ManagedProjectStructureSnapshot;
}

/** INFRASTRUCTURE_WRAPPER: inventories the structured boundary around policy-owned project files. */
export class ManagedProjectStructure {
  constructor(private readonly dataRoot: string, private readonly driver: ManagedProjectStructureDriver) {}

  static create(dataRoot: string): ManagedProjectStructure {
    return new ManagedProjectStructure(dataRoot, {
      inspect: (root) => productionSnapshot(root),
    });
  }

  static createNull(
    entries: ManagedProjectStructureEntry[] = [],
    dataRoot = "/null-worker-agent",
  ): ManagedProjectStructure {
    return new ManagedProjectStructure(dataRoot, {
      inspect: (root) => ({
        dataRoot: root,
        projectsRoot: join(root, "projects"),
        entries: structuredClone(entries),
      }),
    });
  }

  inspect(): ManagedProjectStructureSnapshot {
    return this.driver.inspect(this.dataRoot);
  }
}

function productionSnapshot(dataRoot: string): ManagedProjectStructureSnapshot {
  requireDirectory(dataRoot, "DATA_ROOT");
  requireFile(join(dataRoot, "PROJECT.md"), "PROJECT.md");
  const projectsRoot = join(dataRoot, "projects");
  requireDirectory(projectsRoot, "DATA_ROOT/projects");
  const entries = readdirSync(projectsRoot, { withFileTypes: true })
    .map((entry): ManagedProjectStructureEntry => {
      const kind: ManagedProjectEntryKind = entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : entry.isSymbolicLink()
            ? "symbolic-link"
            : "other";
      return {
        name: entry.name,
        kind,
        hasSequenceFile: kind === "directory" && isRegularFile(join(projectsRoot, entry.name, "sequence.md")),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { dataRoot, projectsRoot, entries };
}

function requireDirectory(path: string, label: string): void {
  try {
    if (statSync(path).isDirectory()) return;
  } catch {}
  throw new Error(`${label} is missing or is not a directory: ${path}`);
}

function requireFile(path: string, label: string): void {
  try {
    if (statSync(path).isFile()) return;
  } catch {}
  throw new Error(`${label} is missing or is not a file: ${path}`);
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
