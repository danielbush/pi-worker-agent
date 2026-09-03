import { expect, test } from "bun:test";
import { ManagedProjectCatalog } from "../../infrastructure/filesystem/managed-project-catalog.ts";
import { Registry } from "../../storage/registry.ts";
import { ProjectCatalogReporter } from "../project-catalog-reporter.ts";

const PROJECT = {
  id: "project_demo",
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

test("fails when a project directory is not registered", () => {
  // arrange
  const reporter = new ProjectCatalogReporter(
    Registry.createNull(),
    ManagedProjectCatalog.createNull(["demo"]),
  );

  // act / assert
  expect(() => reporter.inspect()).toThrow("Project directories are not registered: demo");
});
