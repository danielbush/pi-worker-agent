import type { Id } from "../domain/id.ts";
import type { Project } from "../domain/project.ts";
import { WorkspaceDirectory, type WorkspacePreflight } from "../infrastructure/filesystem/workspace-directory.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";

export interface RegisterWorkspaceInput {
  name: string;
  preflight: WorkspacePreflight;
  createIfMissing: boolean;
  userApproved: boolean;
  approvedBySessionId: string;
}

/** INFRASTRUCTURE_CONSUMER: records a workspace only after an externally approved preflight. */
export class WorkspaceRegistrar {
  constructor(
    private readonly registry: Registry,
    private readonly directories: WorkspaceDirectory,
    private readonly ids: Pick<Id, "createProjectId">,
    private readonly clock: Clock,
  ) {}

  static create(registry: Registry, directories: WorkspaceDirectory, ids: Pick<Id, "createProjectId">): WorkspaceRegistrar {
    return new WorkspaceRegistrar(registry, directories, ids, Clock.create());
  }

  register(input: RegisterWorkspaceInput): Project {
    if (!input.userApproved) throw new Error("Workspace authorization requires user approval");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.name)) {
      throw new Error(`Invalid workspace name: ${input.name}`);
    }
    const rootDir = this.directories.materialize(input.preflight, input.createIfMissing);
    const named = this.registry.projects.list().find((workspace) => workspace.name === input.name);
    if (named && named.rootDir !== rootDir) {
      throw new Error(`Workspace name is already registered for another path: ${input.name}`);
    }
    const existing = named ?? this.registry.projects.list().find((workspace) => workspace.rootDir === rootDir);
    const timestamp = this.clock.now();
    const workspace: Project = existing ?? {
      id: this.ids.createProjectId(),
      name: input.name,
      rootDir,
      createdAt: timestamp,
      lastUsedAt: timestamp,
      authorizedAt: timestamp,
      authorizedBySessionId: input.approvedBySessionId,
    };
    this.registry.transaction(() => {
      if (!existing) this.registry.projects.create(workspace);
      this.registry.projects.authorize(workspace.id, timestamp, input.approvedBySessionId);
    });
    return {
      ...workspace,
      lastUsedAt: timestamp,
      authorizedAt: timestamp,
      authorizedBySessionId: input.approvedBySessionId,
    };
  }
}
