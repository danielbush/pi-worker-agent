import { accessSync, constants, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export type FileKind = "directory" | "file" | "symbolic-link" | "other" | "missing";

export interface FileSystemEntry {
  name: string;
  kind: Exclude<FileKind, "missing">;
}

interface FileSystemDriver {
  kind(path: string): FileKind;
  entryKind(path: string): FileKind;
  entries(path: string): FileSystemEntry[];
  createDirectory(path: string): void;
  move(source: string, destination: string): void;
  createTextFile(path: string, content: string): boolean;
  canonicalPath(path: string): string;
  isWritable(path: string): boolean;
}

export interface NullFileSystemState {
  directories?: string[];
  files?: string[];
  symbolicLinks?: string[];
  other?: string[];
  canonicalPaths?: Record<string, string>;
  unwritable?: string[];
}

/** INFRASTRUCTURE_WRAPPER: provides application-owned file and directory operations. */
export class FileSystem {
  constructor(private readonly driver: FileSystemDriver) {}

  static create(): FileSystem {
    return new FileSystem(new NodeFileSystemDriver());
  }

  static createNull(state: NullFileSystemState = {}): FileSystem {
    return new FileSystem(new MemoryFileSystemDriver(state));
  }

  kind(path: string): FileKind { return this.driver.kind(path); }
  entryKind(path: string): FileKind { return this.driver.entryKind(path); }
  entries(path: string): FileSystemEntry[] { return this.driver.entries(path); }
  createDirectory(path: string): void { this.driver.createDirectory(path); }
  move(source: string, destination: string): void { this.driver.move(source, destination); }
  createTextFile(path: string, content: string): boolean { return this.driver.createTextFile(path, content); }
  canonicalPath(path: string): string { return this.driver.canonicalPath(path); }
  isWritable(path: string): boolean { return this.driver.isWritable(path); }
}

class NodeFileSystemDriver implements FileSystemDriver {
  kind(path: string): FileKind {
    try {
      const result = statSync(path);
      if (result.isDirectory()) return "directory";
      if (result.isFile()) return "file";
      return "other";
    } catch {
      return "missing";
    }
  }

  entryKind(path: string): FileKind {
    try {
      const result = lstatSync(path);
      if (result.isDirectory()) return "directory";
      if (result.isFile()) return "file";
      if (result.isSymbolicLink()) return "symbolic-link";
      return "other";
    } catch {
      return "missing";
    }
  }

  entries(path: string): FileSystemEntry[] {
    return readdirSync(path, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symbolic-link" : "other",
    }));
  }

  createDirectory(path: string): void { mkdirSync(path, { recursive: true }); }
  move(source: string, destination: string): void { renameSync(source, destination); }
  createTextFile(path: string, content: string): boolean {
    try {
      writeFileSync(path, content, { flag: "wx" });
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
      throw error;
    }
  }

  canonicalPath(path: string): string { return realpathSync(path); }

  isWritable(path: string): boolean {
    try { accessSync(path, constants.W_OK); return true; } catch { return false; }
  }
}

class MemoryFileSystemDriver implements FileSystemDriver {
  private readonly paths = new Map<string, Exclude<FileKind, "missing">>();
  private readonly canonicalPaths = new Map<string, string>();
  private readonly unwritable: Set<string>;

  constructor(state: NullFileSystemState) {
    this.unwritable = new Set((state.unwritable ?? []).map((path) => resolve(path)));
    for (const [path, canonical] of Object.entries(state.canonicalPaths ?? {})) this.canonicalPaths.set(resolve(path), resolve(canonical));
    for (const path of state.directories ?? []) this.addDirectory(path);
    for (const path of state.files ?? []) this.add(path, "file");
    for (const path of state.symbolicLinks ?? []) this.add(path, "symbolic-link");
    for (const path of state.other ?? []) this.add(path, "other");
  }

  kind(path: string): FileKind { return this.paths.get(resolve(path)) ?? "missing"; }
  entryKind(path: string): FileKind { return this.kind(path); }

  entries(path: string): FileSystemEntry[] {
    const root = resolve(path);
    if (this.kind(root) !== "directory") throw new Error(`Not a directory: ${path}`);
    return [...this.paths.entries()].flatMap(([candidate, kind]) => {
      const nested = relative(root, candidate);
      return nested && nested !== ".." && !nested.startsWith(`..${sep}`) && !nested.includes(sep) ? [{ name: nested, kind }] : [];
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  createDirectory(path: string): void { this.addDirectory(path); }

  move(source: string, destination: string): void {
    const from = resolve(source);
    const to = resolve(destination);
    if (!this.paths.has(from)) throw new Error(`Path does not exist: ${source}`);
    if (this.paths.has(to)) throw new Error(`Path already exists: ${destination}`);
    this.addDirectory(dirname(to));
    const moving = [...this.paths.entries()].filter(([path]) => path === from || path.startsWith(`${from}${sep}`));
    for (const [path] of moving) this.paths.delete(path);
    for (const [path, kind] of moving) this.paths.set(path === from ? to : `${to}${path.slice(from.length)}`, kind);
  }

  canonicalPath(path: string): string {
    const target = resolve(path);
    if (this.kind(target) === "missing") throw new Error(`Path does not exist: ${path}`);
    return this.canonicalPaths.get(target) ?? target;
  }

  isWritable(path: string): boolean {
    const target = resolve(path);
    return this.kind(target) !== "missing" && !this.unwritable.has(target);
  }

  createTextFile(path: string, _content: string): boolean {
    const target = resolve(path);
    if (this.paths.has(target)) return false;
    if (this.kind(dirname(target)) !== "directory") throw new Error(`Parent directory does not exist: ${dirname(target)}`);
    this.paths.set(target, "file");
    return true;
  }

  private addDirectory(path: string): void {
    const target = resolve(path);
    const parent = dirname(target);
    if (parent !== target && !this.paths.has(parent)) this.addDirectory(parent);
    this.paths.set(target, "directory");
  }

  private add(path: string, kind: Exclude<FileKind, "missing">): void {
    this.addDirectory(dirname(path));
    this.paths.set(resolve(path), kind);
  }
}
