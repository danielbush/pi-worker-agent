import type { Id } from "../domain/id.ts";
import { ProjectCollectionPaths } from "../domain/project-collection-paths.ts";
import type { Project } from "../domain/project.ts";
import type { Workspace } from "../domain/workspace.ts";
import { Id as ProductionId } from "../domain/id.ts";
import { DiagnosticProjectDirectory } from "./diagnostic-project-directory.ts";
import { FileSystem } from "../infrastructure/filesystem/file-system.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";

export interface DiagnosticProjectPreparation { project: Project; workspace: Workspace; }

/** INFRASTRUCTURE_CONSUMER: prepares and durably indexes the conventional application-owned diagnostic location. */
export class DiagnosticProjectPreparer {
  constructor(
    private readonly registry: Registry,
    private readonly directory: DiagnosticProjectDirectory,
    private readonly ids: Pick<Id, "createProjectId" | "createWorkspaceId">,
    private readonly clock: Clock,
  ) {}

  static create(dataRoot: string, registry: Registry): DiagnosticProjectPreparer {
    const paths = new ProjectCollectionPaths(dataRoot);
    return new DiagnosticProjectPreparer(registry, DiagnosticProjectDirectory.create(paths, FileSystem.create()), ProductionId.create(), Clock.create());
  }

  prepare(): DiagnosticProjectPreparation {
    const location = this.directory.prepare();
    const timestamp = this.clock.now();
    let project = this.registry.projects.getByDirectoryName(location.directoryName);
    if (project && project.collection !== "test") throw new Error(`Reserved diagnostic project name is already registered in ${project.collection}: ${location.directoryName}`);
    if (!project) {
      project = {
        id: this.ids.createProjectId(), collection: "test", directoryName: location.directoryName,
        title: "System diagnostics", description: "Application-owned workspace for focused, opt-in diagnostics.",
        createdAt: timestamp, lastUsedAt: timestamp,
      };
      this.registry.projects.create(project);
    }
    let workspace = this.registry.workspaces.list().find((candidate) => candidate.rootDir === location.workspaceRoot);
    if (!workspace) {
      workspace = {
        id: this.ids.createWorkspaceId(), name: "system-diagnostics", rootDir: location.workspaceRoot,
        createdAt: timestamp, lastUsedAt: timestamp, authorizedAt: null, authorizedBySessionId: null,
      };
      this.registry.workspaces.create(workspace);
    }
    if (!workspace.authorizedAt) {
      this.registry.workspaces.authorize(workspace.id, timestamp, "system-diagnostic-convention");
      workspace = { ...workspace, authorizedAt: timestamp, authorizedBySessionId: "system-diagnostic-convention", lastUsedAt: timestamp };
    }
    return { project, workspace };
  }
}
