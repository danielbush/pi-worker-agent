import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { FileSystem, type NullFileSystemState } from "../infrastructure/filesystem/file-system.ts";

export interface WorkspacePreflight {
  requestedPath: string;
  canonicalPath: string;
  exists: boolean;
  gitRepository: boolean;
}

/** INFRASTRUCTURE_CONSUMER: verifies and, after approval, creates workspace directories. */
export class WorkspaceDirectory {
  private inspections: WorkspacePreflight[] = [];
  private creations: string[] = [];

  constructor(private readonly cwd: string, private readonly fileSystem: FileSystem) {}

  static create(cwd: string, fileSystem: FileSystem): WorkspaceDirectory {
    return new WorkspaceDirectory(cwd, fileSystem);
  }

  static createNull(preflights: Record<string, WorkspacePreflight> = {}, cwd = "/"): WorkspaceDirectory {
    const state: NullFileSystemState = { directories: [], canonicalPaths: {} };
    for (const preflight of Object.values(preflights)) {
      if (preflight.exists) {
        state.directories!.push(preflight.requestedPath, preflight.canonicalPath);
        state.canonicalPaths![preflight.requestedPath] = preflight.canonicalPath;
        if (preflight.gitRepository) state.directories!.push(join(preflight.canonicalPath, ".git"));
      } else {
        const requestedParent = dirname(preflight.requestedPath);
        state.directories!.push(requestedParent);
        state.canonicalPaths![requestedParent] = dirname(preflight.canonicalPath);
      }
    }
    return new WorkspaceDirectory(cwd, FileSystem.createNull(state));
  }

  get state(): { inspections: WorkspacePreflight[]; creations: string[] } {
    return { inspections: structuredClone(this.inspections), creations: [...this.creations] };
  }

  inspect(path: string): WorkspacePreflight {
    const result = this.preflight(path);
    this.inspections.push(structuredClone(result));
    return result;
  }

  materialize(approved: WorkspacePreflight, createIfMissing: boolean): string {
    const current = this.preflight(approved.requestedPath);
    if (current.canonicalPath !== approved.canonicalPath || current.exists !== approved.exists) {
      throw new Error("Workspace path changed after approval; authorization was not recorded");
    }
    if (!current.exists) {
      if (!createIfMissing) throw new Error(`Workspace does not exist: ${current.requestedPath}`);
      this.fileSystem.createDirectory(current.requestedPath);
      const created = this.fileSystem.canonicalPath(current.requestedPath);
      this.creations.push(created);
      if (created !== approved.canonicalPath) {
        throw new Error("Created workspace resolved outside the user-approved path; authorization was not recorded");
      }
      return created;
    }
    return this.fileSystem.canonicalPath(current.requestedPath);
  }

  private preflight(input: string): WorkspacePreflight {
    const requestedPath = resolve(this.cwd, input);
    if (this.fileSystem.kind(requestedPath) !== "missing") {
      if (this.fileSystem.kind(requestedPath) !== "directory") throw new Error(`Workspace is not a directory: ${requestedPath}`);
      const canonicalPath = this.fileSystem.canonicalPath(requestedPath);
      return {
        requestedPath,
        canonicalPath,
        exists: true,
        gitRepository: this.fileSystem.kind(join(canonicalPath, ".git")) !== "missing",
      };
    }

    let ancestor = dirname(requestedPath);
    while (this.fileSystem.kind(ancestor) === "missing") {
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error(`Workspace parent cannot be found: ${requestedPath}`);
      ancestor = parent;
    }
    if (this.fileSystem.kind(ancestor) !== "directory") throw new Error(`Workspace parent is not a directory: ${ancestor}`);
    if (!this.fileSystem.isWritable(ancestor)) throw new Error(`Workspace parent is not writable: ${ancestor}`);
    const canonicalAncestor = this.fileSystem.canonicalPath(ancestor);
    const remainder = relative(ancestor, requestedPath);
    const canonicalPath = resolve(canonicalAncestor, remainder);
    if (!isAbsolute(canonicalPath)) throw new Error(`Workspace path cannot be resolved: ${input}`);
    return { requestedPath, canonicalPath, exists: false, gitRepository: false };
  }
}
