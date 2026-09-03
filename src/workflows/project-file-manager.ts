import type { Project } from "../domain/project.ts";
import {
  ProjectTextFiles,
  type ProjectFileChange,
  type ProjectFileMutation,
} from "../infrastructure/filesystem/project-text-files.ts";
import { Registry } from "../storage/registry.ts";

export interface ManageProjectFileInput extends Omit<ProjectFileMutation, "directoryName"> {
  project: string;
}

export interface ManagedProjectFileChange extends ProjectFileChange {
  project: Project;
  diff: string;
}

/** INFRASTRUCTURE_CONSUMER: resolves registered identity before mutating a policy-owned project text file. */
export class ProjectFileManager {
  constructor(private readonly registry: Registry, private readonly files: ProjectTextFiles) {}

  static create(dataRoot: string, registry: Registry): ProjectFileManager {
    return new ProjectFileManager(registry, ProjectTextFiles.create(dataRoot));
  }

  manage(input: ManageProjectFileInput): ManagedProjectFileChange {
    const project = this.registry.projects.getByDirectoryName(input.project)
      ?? this.registry.projects.resolve(input.project);
    if (!project) throw new Error(`Unknown project: ${input.project}`);
    const change = this.files.mutate({
      directoryName: project.directoryName,
      relativePath: input.relativePath,
      operation: input.operation,
      expectedContent: input.expectedContent,
      content: input.content,
    });
    return { project, ...change, diff: formatProjectFileDiff(project.directoryName, change) };
  }
}

export function formatProjectFileDiff(directoryName: string, change: ProjectFileChange): string {
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

function diffLines(content: string | null, prefix: "-" | "+"): string[] {
  if (content === null) return [];
  const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  return lines.map((line) => `${prefix}${line}`);
}
