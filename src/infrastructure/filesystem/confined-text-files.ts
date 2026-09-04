import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, win32 } from "node:path";

export type TextFileOperation = "create" | "update" | "patch" | "delete";

export interface TextFileMutation {
  relativePath: string;
  operation: TextFileOperation;
  expectedContent?: string;
  content?: string;
  expectedText?: string;
  replacementText?: string;
}

export interface TextFileChange {
  relativePath: string;
  operation: TextFileOperation;
  before: string | null;
  after: string | null;
  expectedText?: string;
  replacementText?: string;
}

type Entry = { kind: "file"; content: string; mode: number } | { kind: "directory" | "symbolic-link" | "other" } | null;

interface ConfinedTextFilesDriver {
  inspect(path: string): Entry;
  write(path: string, content: string, mode: number): void;
  remove(path: string): void;
}

/** INFRASTRUCTURE_WRAPPER: confines atomic UTF-8 text-file mutations beneath one trusted root. */
export class ConfinedTextFiles {
  private readonly changes: TextFileChange[] = [];

  constructor(private readonly root: string, private readonly driver: ConfinedTextFilesDriver) {}

  static create(root: string): ConfinedTextFiles {
    return new ConfinedTextFiles(root, {
      inspect: inspectProductionEntry,
      write: writeProductionFile,
      remove: (path) => unlinkSync(path),
    });
  }

  static createNull(files: Record<string, string> = {}, root = "/null-confined-text-files"): ConfinedTextFiles {
    const entries = new Map<string, Entry>();
    entries.set(root, { kind: "directory" });
    for (const [name, content] of Object.entries(files)) {
      const segments = name.split("/");
      for (let length = 1; length < segments.length; length++) {
        entries.set(join(root, ...segments.slice(0, length)), { kind: "directory" });
      }
      entries.set(join(root, ...segments), { kind: "file", content, mode: 0o644 });
    }
    return new ConfinedTextFiles(root, {
      inspect: (path) => structuredClone(entries.get(path) ?? null),
      write: (path, content, mode) => entries.set(path, { kind: "file", content, mode }),
      remove: (path) => { entries.delete(path); },
    });
  }

  get state(): { changes: TextFileChange[] } {
    return { changes: structuredClone(this.changes) };
  }

  mutate(input: TextFileMutation): TextFileChange {
    const target = this.resolveTarget(input.relativePath);
    const current = this.driver.inspect(target);
    if (current && current.kind !== "file") throw new Error(`Confined path is not a regular file: ${input.relativePath}`);
    if (current?.kind === "file") requireText(current.content, "Existing confined file");

    let change: TextFileChange;
    if (input.operation === "create") {
      if (current) throw new Error(`Confined text file already exists: ${input.relativePath}`);
      if (input.expectedContent !== undefined || input.expectedText !== undefined || input.replacementText !== undefined) {
        throw new Error("Create accepts replacement content only");
      }
      const content = requireMutationContent(input.content, "create");
      this.driver.write(target, content, 0o644);
      change = { relativePath: input.relativePath, operation: input.operation, before: null, after: content };
    } else if (input.operation === "update") {
      if (!current || current.kind !== "file") throw new Error(`Confined text file does not exist: ${input.relativePath}`);
      if (input.expectedText !== undefined || input.replacementText !== undefined) throw new Error("Update accepts expectedContent and content only");
      requireExpectedContent(input.expectedContent, current.content);
      const content = requireMutationContent(input.content, "update");
      this.driver.write(target, content, current.mode);
      change = { relativePath: input.relativePath, operation: input.operation, before: current.content, after: content };
    } else if (input.operation === "patch") {
      if (!current || current.kind !== "file") throw new Error(`Confined text file does not exist: ${input.relativePath}`);
      if (input.expectedContent !== undefined || input.content !== undefined) throw new Error("Patch accepts expectedText and replacementText only");
      const expectedText = requirePatchText(input.expectedText, "expectedText", false);
      const replacementText = requirePatchText(input.replacementText, "replacementText", true);
      const occurrences = countOccurrences(current.content, expectedText);
      if (occurrences === 0) throw new Error("Patch text was not found; inspect the relevant section again before updating");
      if (occurrences > 1) throw new Error("Patch text is ambiguous because it occurs more than once");
      const content = current.content.replace(expectedText, replacementText);
      requireText(content, "Confined text file content");
      this.driver.write(target, content, current.mode);
      change = {
        relativePath: input.relativePath, operation: input.operation,
        before: current.content, after: content, expectedText, replacementText,
      };
    } else if (input.operation === "delete") {
      if (!current || current.kind !== "file") throw new Error(`Confined text file does not exist: ${input.relativePath}`);
      requireExpectedContent(input.expectedContent, current.content);
      if (input.content !== undefined || input.expectedText !== undefined || input.replacementText !== undefined) {
        throw new Error("Delete accepts expectedContent only");
      }
      this.driver.remove(target);
      change = { relativePath: input.relativePath, operation: input.operation, before: current.content, after: null };
    } else {
      throw new Error(`Unsupported text file operation: ${String(input.operation)}`);
    }
    this.changes.push(structuredClone(change));
    return change;
  }

  private resolveTarget(relativePath: string): string {
    if (!relativePath || isAbsolute(relativePath) || win32.isAbsolute(relativePath) || relativePath.includes("\\")) {
      throw new Error(`Confined text file path must be relative: ${relativePath}`);
    }
    const segments = relativePath.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`Confined text file path contains an invalid segment: ${relativePath}`);
    }
    requireDirectory(this.driver.inspect(this.root), "confined root");
    let parent = this.root;
    for (const segment of segments.slice(0, -1)) {
      parent = join(parent, segment);
      requireDirectory(this.driver.inspect(parent), relativePath);
    }
    const target = join(parent, segments.at(-1)!);
    if (basename(target) !== segments.at(-1)) throw new Error(`Confined text file path is invalid: ${relativePath}`);
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
        throw new Error(`Confined file is not valid UTF-8 text: ${path}`);
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
  if (entry?.kind === "symbolic-link") throw new Error(`Confined path contains a symbolic link: ${path}`);
  throw new Error(`Confined path is missing or is not a directory: ${path}`);
}

function requireMutationContent(content: string | undefined, operation: string): string {
  if (content === undefined) throw new Error(`${operation} requires replacement content`);
  requireText(content, "Confined text file content");
  return content;
}

function requirePatchText(text: string | undefined, field: string, allowEmpty: boolean): string {
  if (text === undefined || (!allowEmpty && text.length === 0)) throw new Error(`Patch requires ${field}${allowEmpty ? "" : " to be non-empty"}`);
  requireText(text, `Patch ${field}`);
  return text;
}

function countOccurrences(content: string, expectedText: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - expectedText.length) {
    const index = content.indexOf(expectedText, offset);
    if (index < 0) break;
    count += 1;
    offset = index + 1;
  }
  return count;
}

function requireExpectedContent(expected: string | undefined, current: string): void {
  if (expected === undefined) throw new Error("Update and delete require expectedContent from the inspected file");
  if (expected !== current) throw new Error("Confined text file changed since inspection; inspect it again before updating");
}

function requireText(content: string, label: string): void {
  if (content.includes("\0")) throw new Error(`${label} contains NUL bytes and is not supported as text`);
  if (Buffer.byteLength(content, "utf8") > 1_048_576) throw new Error(`${label} exceeds the 1 MiB manager limit`);
}
