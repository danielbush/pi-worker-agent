import type { Id } from "../domain/id.ts";
import type { Workspace } from "../domain/workspace.ts";
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
    private readonly ids: Pick<Id, "createWorkspaceId">,
    private readonly clock: Clock,
  ) {}

  static create(registry: Registry, directories: WorkspaceDirectory, ids: Pick<Id, "createWorkspaceId">): WorkspaceRegistrar {
    return new WorkspaceRegistrar(registry, directories, ids, Clock.create());
  }

  register(input: RegisterWorkspaceInput): Workspace {
    if (!input.userApproved) throw new Error("Workspace authorization requires user approval");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.name)) {
      throw new Error(`Invalid workspace name: ${input.name}`);
    }
    const rootDir = this.directories.materialize(input.preflight, input.createIfMissing);
    const named = this.registry.workspaces.list().find((workspace) => workspace.name === input.name);
    if (named && named.rootDir !== rootDir) {
      throw new Error(`Workspace name is already registered for another path: ${input.name}`);
    }
    const existing = named ?? this.registry.workspaces.list().find((workspace) => workspace.rootDir === rootDir);
    const timestamp = this.clock.now();
    const workspace: Workspace = existing ?? {
      id: this.ids.createWorkspaceId(),
      name: input.name,
      rootDir,
      createdAt: timestamp,
      lastUsedAt: timestamp,
      authorizedAt: timestamp,
      authorizedBySessionId: input.approvedBySessionId,
    };
    this.registry.transaction(() => {
      if (!existing) this.registry.workspaces.create(workspace);
      this.registry.workspaces.authorize(workspace.id, timestamp, input.approvedBySessionId);
    });
    return {
      ...workspace,
      lastUsedAt: timestamp,
      authorizedAt: timestamp,
      authorizedBySessionId: input.approvedBySessionId,
    };
  }
}
