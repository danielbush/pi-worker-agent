import { expect, test } from "bun:test";
import { ManagedProjectDirectory } from "../../infrastructure/filesystem/managed-project-directory.ts";
import { Clock } from "../../infrastructure/system/clock.ts";
import { Registry } from "../../storage/registry.ts";
import { ProjectRegistrar } from "../project-registrar.ts";
import { ProjectTaskLinker } from "../project-task-linker.ts";
import { ProjectTaskReporter } from "../project-task-reporter.ts";

const TIMESTAMP = "2026-09-02T12:00:00Z";

test("registers a project directory and reports its outstanding linked tasks", () => {
  // arrange
  const registry = Registry.createNull({ tasks: [
    {
      id: "task_running",
      workspaceId: "workspace_demo",
      title: "Running task",
      status: "running",
      createdAt: TIMESTAMP,
      finishedAt: null,
    },
    {
      id: "task_completed",
      workspaceId: "workspace_demo",
      title: "Completed task",
      status: "completed",
      createdAt: "2026-09-01T12:00:00Z",
      finishedAt: TIMESTAMP,
    },
  ] });
  const registrar = new ProjectRegistrar(
    registry,
    ManagedProjectDirectory.createNull(["demo"]),
    { createProjectId: () => "project_demo" },
    Clock.createNull(TIMESTAMP),
  );

  // act
  const project = registrar.register({
    directoryName: "demo",
    title: "Demo project",
    description: "Recovery context",
  });
  new ProjectTaskLinker(registry, Clock.createNull(TIMESTAMP)).link(project.id, "task_running");
  new ProjectTaskLinker(registry, Clock.createNull(TIMESTAMP)).link(project.id, "task_completed");
  const report = ProjectTaskReporter.create(registry).inspect("proj", true);

  // assert
  expect(project).toMatchObject({
    id: "project_demo",
    directoryName: "demo",
    title: "Demo project",
    description: "Recovery context",
  });
  expect(report.tasks.map(({ id, status }) => ({ id, status }))).toEqual([
    { id: "task_running", status: "running" },
  ]);
});

test("registers a project from the test collection", () => {
  const registry = Registry.createNull();
  const registrar = new ProjectRegistrar(
    registry,
    ManagedProjectDirectory.createNull([{ collection: "test", name: "diagnostic" }]),
    { createProjectId: () => "project_diagnostic" },
    Clock.createNull(TIMESTAMP),
  );

  const project = registrar.register({ directoryName: "diagnostic", title: "Diagnostic", collection: "test" });

  expect(project.collection).toBe("test");
});

test("refuses to register a project without a matching management directory", () => {
  // arrange
  const registrar = new ProjectRegistrar(
    Registry.createNull(),
    ManagedProjectDirectory.createNull(),
    { createProjectId: () => "project_missing" },
    Clock.createNull(TIMESTAMP),
  );

  // act
  const registration = () => registrar.register({ directoryName: "missing", title: "Missing" });

  // assert
  expect(registration).toThrow("Managed-project directory does not exist");
});
