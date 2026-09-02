import { accessSync, constants, existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface WorkspacePreflight {
  requestedPath: string;
  canonicalPath: string;
  exists: boolean;
  gitRepository: boolean;
}

interface WorkspaceDirectoryDriver {
  preflight(path: string): WorkspacePreflight;
  create(path: string): string;
  canonical(path: string): string;
}

/** INFRASTRUCTURE_WRAPPER: verifies and, after approval, creates workspace directories. */
export class WorkspaceDirectory {
  private inspections: WorkspacePreflight[] = [];
  private creations: string[] = [];

  constructor(private readonly driver: WorkspaceDirectoryDriver) {}

  static create(cwd: string): WorkspaceDirectory {
    return new WorkspaceDirectory({
      preflight: (input) => productionPreflight(input, cwd),
      create: (path) => {
        mkdirSync(path, { recursive: true });
        return realpathSync(path);
      },
      canonical: (path) => realpathSync(path),
    });
  }

  static createNull(preflights: Record<string, WorkspacePreflight> = {}): WorkspaceDirectory {
    return new WorkspaceDirectory({
      preflight: (path) => {
        const result = preflights[path];
        if (!result) throw new Error(`Workspace path cannot be verified: ${path}`);
        return structuredClone(result);
      },
      create: (path) => preflights[path]?.canonicalPath ?? path,
      canonical: (path) => preflights[path]?.canonicalPath ?? path,
    });
  }

  get state(): { inspections: WorkspacePreflight[]; creations: string[] } {
    return { inspections: structuredClone(this.inspections), creations: [...this.creations] };
  }

  inspect(path: string): WorkspacePreflight {
    const result = this.driver.preflight(path);
    this.inspections.push(structuredClone(result));
    return result;
  }

  materialize(approved: WorkspacePreflight, createIfMissing: boolean): string {
    const current = this.driver.preflight(approved.requestedPath);
    if (current.canonicalPath !== approved.canonicalPath || current.exists !== approved.exists) {
      throw new Error("Workspace path changed after approval; authorization was not recorded");
    }
    if (!current.exists) {
      if (!createIfMissing) throw new Error(`Workspace does not exist: ${current.requestedPath}`);
      const created = this.driver.create(current.requestedPath);
      this.creations.push(created);
      if (created !== approved.canonicalPath) {
        throw new Error("Created workspace resolved outside the user-approved path; authorization was not recorded");
      }
      return created;
    }
    return this.driver.canonical(current.requestedPath);
  }
}

function productionPreflight(input: string, cwd: string): WorkspacePreflight {
  const requestedPath = resolve(cwd, input);
  if (existsSync(requestedPath)) {
    if (!statSync(requestedPath).isDirectory()) throw new Error(`Workspace is not a directory: ${requestedPath}`);
    const canonicalPath = realpathSync(requestedPath);
    return {
      requestedPath,
      canonicalPath,
      exists: true,
      gitRepository: existsSync(join(canonicalPath, ".git")),
    };
  }

  let ancestor = dirname(requestedPath);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`Workspace parent cannot be found: ${requestedPath}`);
    ancestor = parent;
  }
  if (!statSync(ancestor).isDirectory()) throw new Error(`Workspace parent is not a directory: ${ancestor}`);
  accessSync(ancestor, constants.W_OK);
  const canonicalAncestor = realpathSync(ancestor);
  const remainder = relative(ancestor, requestedPath);
  const canonicalPath = resolve(canonicalAncestor, remainder);
  if (!isAbsolute(canonicalPath)) throw new Error(`Workspace path cannot be resolved: ${input}`);
  return { requestedPath, canonicalPath, exists: false, gitRepository: false };
}
