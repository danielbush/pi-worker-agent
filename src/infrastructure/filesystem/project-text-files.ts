import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, win32 } from "node:path";

export type ProjectFileOperation = "create" | "update" | "delete";

export interface ProjectFileMutation {
  directoryName: string;
  relativePath: string;
  operation: ProjectFileOperation;
  expectedContent?: string;
  content?: string;
}

export interface ProjectFileChange {
  relativePath: string;
  operation: ProjectFileOperation;
  before: string | null;
  after: string | null;
}

type Entry = { kind: "file"; content: string; mode: number } | { kind: "directory" | "symbolic-link" | "other" } | null;

interface ProjectTextFilesDriver {
  inspect(path: string): Entry;
  write(path: string, content: string, mode: number): void;
  remove(path: string): void;
}

/** INFRASTRUCTURE_WRAPPER: confines atomic text-file mutations to one managed-project directory. */
export class ProjectTextFiles {
  private readonly changes: ProjectFileChange[] = [];

  constructor(private readonly dataRoot: string, private readonly driver: ProjectTextFilesDriver) {}

  static create(dataRoot: string): ProjectTextFiles {
    return new ProjectTextFiles(dataRoot, {
      inspect: inspectProductionEntry,
      write: writeProductionFile,
      remove: (path) => unlinkSync(path),
    });
  }

  static createNull(files: Record<string, string> = {}, dataRoot = "/null-worker-agent"): ProjectTextFiles {
    const entries = new Map<string, Entry>();
    entries.set(join(dataRoot, "projects"), { kind: "directory" });
    for (const [name, content] of Object.entries(files)) {
      const segments = name.split("/");
      for (let length = 1; length < segments.length; length++) {
        entries.set(join(dataRoot, "projects", ...segments.slice(0, length)), { kind: "directory" });
      }
      entries.set(join(dataRoot, "projects", ...segments), { kind: "file", content, mode: 0o644 });
    }
    return new ProjectTextFiles(dataRoot, {
      inspect: (path) => structuredClone(entries.get(path) ?? null),
      write: (path, content, mode) => entries.set(path, { kind: "file", content, mode }),
      remove: (path) => { entries.delete(path); },
    });
  }

  get state(): { changes: ProjectFileChange[] } {
    return { changes: structuredClone(this.changes) };
  }

  mutate(input: ProjectFileMutation): ProjectFileChange {
    const target = this.resolveTarget(input.directoryName, input.relativePath);
    const current = this.driver.inspect(target);
    if (current && current.kind !== "file") throw new Error(`Project path is not a regular file: ${input.relativePath}`);
    if (current?.kind === "file") requireText(current.content, "Existing project file");

    let change: ProjectFileChange;
    if (input.operation === "create") {
      if (current) throw new Error(`Project file already exists: ${input.relativePath}`);
      const content = requireMutationContent(input.content, "create");
      this.driver.write(target, content, 0o644);
      change = { relativePath: input.relativePath, operation: input.operation, before: null, after: content };
    } else if (input.operation === "update") {
      if (!current || current.kind !== "file") throw new Error(`Project file does not exist: ${input.relativePath}`);
      requireExpectedContent(input.expectedContent, current.content);
      const content = requireMutationContent(input.content, "update");
      this.driver.write(target, content, current.mode);
      change = { relativePath: input.relativePath, operation: input.operation, before: current.content, after: content };
    } else if (input.operation === "delete") {
      if (!current || current.kind !== "file") throw new Error(`Project file does not exist: ${input.relativePath}`);
      requireExpectedContent(input.expectedContent, current.content);
      if (input.content !== undefined) throw new Error("Delete does not accept replacement content");
      this.driver.remove(target);
      change = { relativePath: input.relativePath, operation: input.operation, before: current.content, after: null };
    } else {
      throw new Error(`Unsupported project file operation: ${String(input.operation)}`);
    }
    this.changes.push(structuredClone(change));
    return change;
  }

  private resolveTarget(directoryName: string, relativePath: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(directoryName)) {
      throw new Error(`Invalid project directory name: ${directoryName}`);
    }
    if (!relativePath || isAbsolute(relativePath) || win32.isAbsolute(relativePath) || relativePath.includes("\\")) {
      throw new Error(`Project file path must be relative: ${relativePath}`);
    }
    const segments = relativePath.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment === ".git")) {
      throw new Error(`Project file path contains an invalid segment: ${relativePath}`);
    }
    const projectsRoot = join(this.dataRoot, "projects");
    requireDirectory(this.driver.inspect(projectsRoot), "DATA_ROOT/projects");
    const projectRoot = join(projectsRoot, directoryName);
    requireDirectory(this.driver.inspect(projectRoot), directoryName);
    let parent = projectRoot;
    for (const segment of segments.slice(0, -1)) {
      parent = join(parent, segment);
      requireDirectory(this.driver.inspect(parent), relativePath);
    }
    const target = join(parent, segments.at(-1)!);
    if (basename(target) !== segments.at(-1)) throw new Error(`Project file path is invalid: ${relativePath}`);
    return target;
  }
}

function inspectProductionEntry(path: string): Entry {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { kind: "symbolic-link" };
    if (stat.isDirectory()) return { kind: "directory" };
    if (stat.isFile()) {
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
      } catch {
        throw new Error(`Project file is not valid UTF-8 text: ${path}`);
      }
      return { kind: "file", content, mode: stat.mode & 0o777 };
    }
    return { kind: "other" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function writeProductionFile(path: string, content: string, mode: number): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode });
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function requireDirectory(entry: Entry, path: string): void {
  if (entry?.kind === "directory") return;
  if (entry?.kind === "symbolic-link") throw new Error(`Project path contains a symbolic link: ${path}`);
  throw new Error(`Project directory path is missing or is not a directory: ${path}`);
}

function requireMutationContent(content: string | undefined, operation: string): string {
  if (content === undefined) throw new Error(`${operation} requires replacement content`);
  requireText(content, "Project file content");
  return content;
}

function requireExpectedContent(expected: string | undefined, current: string): void {
  if (expected === undefined) throw new Error("Update and delete require expectedContent from the inspected file");
  if (expected !== current) throw new Error("Project file changed since inspection; inspect it again before updating");
}

function requireText(content: string, label: string): void {
  if (content.includes("\0")) throw new Error(`${label} contains NUL bytes and is not supported as text`);
  if (Buffer.byteLength(content, "utf8") > 1_048_576) throw new Error(`${label} exceeds the 1 MiB manager limit`);
}
