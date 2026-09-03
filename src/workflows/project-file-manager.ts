import { isAbsolute, join, win32 } from "node:path";
import type { Project } from "../domain/project.ts";
import {
  ConfinedTextFiles,
  type TextFileChange,
  type TextFileMutation,
} from "../infrastructure/filesystem/confined-text-files.ts";
import { Registry } from "../storage/registry.ts";

export interface ManageProjectFileInput extends Omit<TextFileMutation, "relativePath"> {
  project: string;
  relativePath: string;
}

export interface ManagedProjectFileChange extends TextFileChange {
  project: Project;
  diff: string;
}

/** INFRASTRUCTURE_CONSUMER: resolves registered identity before mutating a policy-owned project text file. */
export class ProjectFileManager {
  constructor(private readonly registry: Registry, private readonly files: ConfinedTextFiles) {}

  static create(dataRoot: string, registry: Registry): ProjectFileManager {
    return new ProjectFileManager(registry, ConfinedTextFiles.create(join(dataRoot, "projects")));
  }

  manage(input: ManageProjectFileInput): ManagedProjectFileChange {
    const project = this.registry.projects.getByDirectoryName(input.project)
      ?? this.registry.projects.resolve(input.project);
    if (!project) throw new Error(`Unknown project: ${input.project}`);
    requireProjectRelativePath(input.relativePath);
    const confinedChange = this.files.mutate({
      relativePath: `${project.directoryName}/${input.relativePath}`,
      operation: input.operation,
      expectedContent: input.expectedContent,
      content: input.content,
    });
    const change = { ...confinedChange, relativePath: input.relativePath };
    return { project, ...change, diff: formatProjectFileDiff(project.directoryName, change) };
  }
}

export function formatProjectFileDiff(directoryName: string, change: TextFileChange): string {
  const path = `${directoryName}/${change.relativePath}`;
  const beforePath = change.before === null ? "/dev/null" : `a/${path}`;
  const afterPath = change.after === null ? "/dev/null" : `b/${path}`;
  return [
    `--- ${beforePath}`,
    `+++ ${afterPath}`,
    "@@",
    ...diffLines(change.before, "-"),
    ...diffLines(change.after, "+"),
  ].join("\n");
}

function requireProjectRelativePath(relativePath: string): void {
  if (!relativePath || isAbsolute(relativePath) || win32.isAbsolute(relativePath) || relativePath.includes("\\")) {
    throw new Error(`Project file path must be relative: ${relativePath}`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment === ".git")) {
    throw new Error(`Project file path contains an invalid segment: ${relativePath}`);
  }
}

function diffLines(content: string | null, prefix: "-" | "+"): string[] {
  if (content === null) return [];
  const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  return lines.map((line) => `${prefix}${line}`);
}
