import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectCollectionDirectory, type ProjectCollection } from "../../domain/project-collection.ts";

interface ManagedProjectDirectoryDriver {
  exists(dataRoot: string, collection: ProjectCollection, directoryName: string): boolean;
}

/** INFRASTRUCTURE_WRAPPER: validates project identities against immediate DATA_ROOT project directories. */
export class ManagedProjectDirectory {
  constructor(
    private readonly dataRoot: string,
    private readonly driver: ManagedProjectDirectoryDriver,
  ) {}

  static create(dataRoot: string): ManagedProjectDirectory {
    return new ManagedProjectDirectory(dataRoot, {
      exists: (root, collection, name) => {
        const directory = join(root, projectCollectionDirectory(collection), name);
        try {
          return statSync(directory).isDirectory() && existsSync(join(directory, "sequence.md"));
        } catch {
          return false;
        }
      },
    });
  }

  static createNull(existing: Array<string | { collection: ProjectCollection; name: string }> = [], dataRoot = "/null-worker-agent"): ManagedProjectDirectory {
    const keys = new Set(existing.map((entry) => typeof entry === "string" ? `active:${entry}` : `${entry.collection}:${entry.name}`));
    return new ManagedProjectDirectory(dataRoot, { exists: (_root, collection, name) => keys.has(`${collection}:${name}`) });
  }

  require(directoryName: string, collection: ProjectCollection = "active"): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(directoryName)) {
      throw new Error(`Invalid project directory name: ${directoryName}`);
    }
    if (!this.driver.exists(this.dataRoot, collection, directoryName)) {
      throw new Error(`Managed-project directory does not exist: ${directoryName}`);
    }
  }
}
