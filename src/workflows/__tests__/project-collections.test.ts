import { expect, test } from "bun:test";
import { DiagnosticProjectDirectory } from "../../infrastructure/filesystem/diagnostic-project-directory.ts";
import { ManagedProjectMover } from "../../infrastructure/filesystem/managed-project-mover.ts";
import { Clock } from "../../infrastructure/system/clock.ts";
import { Registry } from "../../storage/registry.ts";
import { DiagnosticProjectPreparer } from "../diagnostic-project-preparer.ts";
import { ProjectArchiver } from "../project-archiver.ts";

const TIMESTAMP = "2026-09-04T00:00:00Z";

test("prepares one conventional diagnostic project and authorized workspace idempotently", () => {
  const registry = Registry.createNull();
  const preparer = new DiagnosticProjectPreparer(
    registry,
    DiagnosticProjectDirectory.createNull(),
    { createProjectId: () => "project_diagnostic", createWorkspaceId: () => "workspace_diagnostic" },
    Clock.createNull(TIMESTAMP),
  );

  const first = preparer.prepare();
  const second = preparer.prepare();

  expect(second).toEqual(first);
  expect(first.project).toMatchObject({ collection: "test", directoryName: "system-diagnostics" });
  expect(first.workspace).toMatchObject({
    rootDir: "/null-worker-agent/projects/.test/system-diagnostics/workspace",
    authorizedBySessionId: "system-diagnostic-convention",
  });
  expect(registry.projects.list("active")).toEqual([]);
});

test("refuses to archive a project with outstanding tasks", () => {
  const project = {
    id: "project_demo", collection: "active" as const, directoryName: "demo", title: "Demo",
    description: null, createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP,
  };
  const task = { id: "task_running", workspaceId: null, title: "Running", status: "running" as const, createdAt: TIMESTAMP, finishedAt: null };
  const registry = Registry.createNull({ projects: [project], tasks: [task], projectTasks: [{ projectId: project.id, taskId: task.id, addedAt: TIMESTAMP }] });

  expect(() => new ProjectArchiver(registry, ManagedProjectMover.createNull()).archive("demo"))
    .toThrow("Cannot archive project with outstanding tasks: task_running");
});

test("archives an active project without changing its identity", () => {
  const project = {
    id: "project_demo", collection: "active" as const, directoryName: "demo", title: "Demo",
    description: null, createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP,
  };
  const registry = Registry.createNull({ projects: [project] });
  const moves: Array<{ directoryName: string; from: "active" | "test" | "archive"; to: "active" | "test" | "archive" }> = [];
  const archiver = new ProjectArchiver(registry, ManagedProjectMover.createNull(moves));

  const archived = archiver.archive("demo");

  expect(archived).toEqual({ ...project, collection: "archive" });
  expect(registry.projects.get(project.id)?.collection).toBe("archive");
  expect(moves).toEqual([{ directoryName: "demo", from: "active", to: "archive" }]);
  expect(() => archiver.archive("demo")).toThrow("Only active projects can be archived");
});
