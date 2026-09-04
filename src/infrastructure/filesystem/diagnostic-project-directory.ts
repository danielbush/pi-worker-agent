import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { projectCollectionDirectory } from "../../domain/project-collection.ts";

export interface DiagnosticProjectLocation {
  directoryName: string;
  projectRoot: string;
  workspaceRoot: string;
}

interface DiagnosticProjectDirectoryDriver { prepare(dataRoot: string): DiagnosticProjectLocation; }

/** INFRASTRUCTURE_WRAPPER: idempotently prepares the application-owned diagnostic project convention. */
export class DiagnosticProjectDirectory {
  constructor(private readonly dataRoot: string, private readonly driver: DiagnosticProjectDirectoryDriver) {}

  static create(dataRoot: string): DiagnosticProjectDirectory {
    return new DiagnosticProjectDirectory(dataRoot, { prepare: productionPrepare });
  }

  static createNull(dataRoot = "/null-worker-agent"): DiagnosticProjectDirectory {
    return new DiagnosticProjectDirectory(dataRoot, { prepare: location });
  }

  prepare(): DiagnosticProjectLocation { return this.driver.prepare(this.dataRoot); }
}

function location(dataRoot: string): DiagnosticProjectLocation {
  const directoryName = "system-diagnostics";
  const projectRoot = join(resolve(dataRoot), projectCollectionDirectory("test"), directoryName);
  return { directoryName, projectRoot, workspaceRoot: join(projectRoot, "workspace") };
}

function productionPrepare(dataRoot: string): DiagnosticProjectLocation {
  const result = location(dataRoot);
  mkdirSync(result.workspaceRoot, { recursive: true });
  mkdirSync(join(result.projectRoot, ".agent"), { recursive: true });
  createIfAbsent(join(result.projectRoot, "sequence.md"), "# System diagnostics\n\nApplication-owned location for focused, opt-in diagnostics.\n");
  createIfAbsent(join(result.projectRoot, ".agent", "tasks.md"), "# taskId|created|status|title\n");
  createIfAbsent(join(result.workspaceRoot, "AGENTS.md"), "# Diagnostic worker instructions\n\nKeep diagnostics narrow, non-destructive, and limited to the requested contract.\n");
  createIfAbsent(join(result.workspaceRoot, "README.md"), "# System diagnostics workspace\n");
  return result;
}

function createIfAbsent(path: string, content: string): void {
  try { writeFileSync(path, content, { flag: "wx" }); } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
}
