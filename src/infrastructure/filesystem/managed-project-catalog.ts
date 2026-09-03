import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface ManagedProjectCatalogDriver {
  inspect(dataRoot: string): string[];
}

/** INFRASTRUCTURE_WRAPPER: validates manager policy roots and lists immediate project directories. */
export class ManagedProjectCatalog {
  constructor(private readonly dataRoot: string, private readonly driver: ManagedProjectCatalogDriver) {}

  static create(dataRoot: string): ManagedProjectCatalog {
    return new ManagedProjectCatalog(dataRoot, {
      inspect: (root) => {
        requireDirectory(root, "DATA_ROOT");
        requireFile(join(root, "PROJECT_MANAGEMENT.md"), "PROJECT_MANAGEMENT.md");
        const projectsRoot = join(root, "projects");
        requireDirectory(projectsRoot, "DATA_ROOT/projects");
        return readdirSync(projectsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b));
      },
    });
  }

  static createNull(projectDirectories: string[] = [], dataRoot = "/null-worker-agent"): ManagedProjectCatalog {
    return new ManagedProjectCatalog(dataRoot, { inspect: () => [...projectDirectories] });
  }

  inspect(): { dataRoot: string; projectDirectories: string[] } {
    return { dataRoot: this.dataRoot, projectDirectories: this.driver.inspect(this.dataRoot) };
  }
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
