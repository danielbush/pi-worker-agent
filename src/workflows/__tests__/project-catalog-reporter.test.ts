import { expect, test } from "bun:test";
import { ManagedProjectCatalog } from "../managed-project-catalog.ts";
import { Registry } from "../../storage/registry.ts";
import { ProjectCatalogReporter } from "../project-catalog-reporter.ts";

const PROJECT = {
  id: "project_demo",
  collection: "active" as const,
  directoryName: "demo",
  title: "Demo",
  description: null,
  createdAt: "2026-09-03T00:00:00Z",
  lastUsedAt: "2026-09-03T00:00:00Z",
};

test("reports configured projects and data root", () => {
  // arrange
  const reporter = new ProjectCatalogReporter(
    Registry.createNull({ projects: [PROJECT] }),
    ManagedProjectCatalog.createNull(["demo"]),
  );

  // act
  const report = reporter.inspect();

  // assert
  expect(report).toEqual({ dataRoot: "/null-worker-agent", projects: [PROJECT] });
});

test("normal listings exclude test and archived projects", () => {
  const reporter = new ProjectCatalogReporter(
    Registry.createNull({ projects: [
      PROJECT,
      { ...PROJECT, id: "project_test", collection: "test", directoryName: "diagnostic" },
      { ...PROJECT, id: "project_archive", collection: "archive", directoryName: "old" },
    ] }),
    ManagedProjectCatalog.createNull(["demo"]),
  );

  expect(reporter.inspect().projects).toEqual([PROJECT]);
});

test("fails when a project directory is not registered", () => {
  // arrange
  const reporter = new ProjectCatalogReporter(
    Registry.createNull(),
    ManagedProjectCatalog.createNull(["demo"]),
  );

  // act / assert
  expect(() => reporter.inspect()).toThrow("Project directories are not registered: demo");
});
