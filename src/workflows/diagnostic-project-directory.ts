import { join } from "node:path";
import { ProjectCollectionPaths } from "../domain/project-collection-paths.ts";
import { FileSystem } from "../infrastructure/filesystem/file-system.ts";

export interface DiagnosticProjectLocation {
  directoryName: string;
  projectRoot: string;
  workspaceRoot: string;
}

/** INFRASTRUCTURE_CONSUMER: idempotently prepares the application-owned diagnostic project convention. */
export class DiagnosticProjectDirectory {
  constructor(private readonly paths: ProjectCollectionPaths, private readonly fileSystem: FileSystem) {}

  static create(paths: ProjectCollectionPaths, fileSystem: FileSystem): DiagnosticProjectDirectory {
    return new DiagnosticProjectDirectory(paths, fileSystem);
  }

  static createNull(paths = new ProjectCollectionPaths("/null-worker-agent")): DiagnosticProjectDirectory {
    return new DiagnosticProjectDirectory(paths, FileSystem.createNull());
  }

  prepare(): DiagnosticProjectLocation {
    const result = this.location();
    this.fileSystem.createDirectory(result.workspaceRoot);
    this.fileSystem.createDirectory(join(result.projectRoot, ".agent"));
    this.fileSystem.createTextFile(join(result.projectRoot, "sequence.md"), "# System diagnostics\n\nApplication-owned location for focused, opt-in diagnostics.\n");
    this.fileSystem.createTextFile(join(result.projectRoot, ".agent", "tasks.md"), "# taskId|created|status|title\n");
    this.fileSystem.createTextFile(join(result.workspaceRoot, "AGENTS.md"), "# Diagnostic worker instructions\n\nKeep diagnostics narrow, non-destructive, and limited to the requested contract.\n");
    this.fileSystem.createTextFile(join(result.workspaceRoot, "README.md"), "# System diagnostics workspace\n");
    return result;
  }

  private location(): DiagnosticProjectLocation {
    const directoryName = "system-diagnostics";
    const projectRoot = this.paths.projectPath("test", directoryName);
    return { directoryName, projectRoot, workspaceRoot: join(projectRoot, "workspace") };
  }
}
