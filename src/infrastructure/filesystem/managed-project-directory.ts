import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

interface ManagedProjectDirectoryDriver {
  exists(dataRoot: string, directoryName: string): boolean;
}

/** INFRASTRUCTURE_WRAPPER: validates project identities against immediate DATA_ROOT project directories. */
export class ManagedProjectDirectory {
  constructor(
    private readonly dataRoot: string,
    private readonly driver: ManagedProjectDirectoryDriver,
  ) {}

  static create(dataRoot: string): ManagedProjectDirectory {
    return new ManagedProjectDirectory(dataRoot, {
      exists: (root, name) => {
        const directory = join(root, "projects", name);
        try {
          return statSync(directory).isDirectory() && existsSync(join(directory, "sequence.md"));
        } catch {
          return false;
        }
      },
    });
  }

  static createNull(existing: string[] = [], dataRoot = "/null-worker-agent"): ManagedProjectDirectory {
    const names = new Set(existing);
    return new ManagedProjectDirectory(dataRoot, { exists: (_root, name) => names.has(name) });
  }

  require(directoryName: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(directoryName)) {
      throw new Error(`Invalid project directory name: ${directoryName}`);
    }
    if (!this.driver.exists(this.dataRoot, directoryName)) {
      throw new Error(`Managed-project directory does not exist: ${directoryName}`);
    }
  }
}
