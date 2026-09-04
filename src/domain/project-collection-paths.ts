import { basename, join } from "node:path";

export type ProjectCollection = "active" | "test" | "archive";

const COLLECTION_DIRECTORIES: Record<ProjectCollection, string> = {
  active: "projects",
  test: "projects/.test",
  archive: "projects/.archive",
};

/**
 * DOMAIN_VALUE_OBJECT: owns the physical mapping from one data root to its policy file
 * and active, test, and archive project collection paths.
 */
export class ProjectCollectionPaths {
  readonly policyFile: string;
  readonly activeRoot: string;
  readonly testRoot: string;
  readonly archiveRoot: string;

  constructor(readonly dataRoot: string) {
    this.policyFile = join(dataRoot, "PROJECT.md");
    this.activeRoot = join(dataRoot, COLLECTION_DIRECTORIES.active);
    this.testRoot = join(dataRoot, COLLECTION_DIRECTORIES.test);
    this.archiveRoot = join(dataRoot, COLLECTION_DIRECTORIES.archive);
  }

  rootFor(collection: ProjectCollection): string {
    if (collection === "active") return this.activeRoot;
    return collection === "test" ? this.testRoot : this.archiveRoot;
  }

  projectPath(collection: ProjectCollection, directoryName: string): string {
    return join(this.rootFor(collection), directoryName);
  }

  isReservedCollectionDirectory(name: string): boolean {
    return name === basename(this.testRoot) || name === basename(this.archiveRoot);
  }
}
