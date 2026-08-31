import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GreetingProjectFixture } from "../src/demo/greeting-project-fixture.ts";
import {
  DEMO_INTENT,
  DEMO_OUTCOMES,
  WorkerDemoTaskCreator,
} from "../src/workflows/worker-demo-task-creator.ts";
import { Registry } from "../src/storage/registry.ts";
import { TaskStore } from "../src/storage/task-store.ts";
import { removeTestDirectory } from "./test-directory.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

class FixedIds {
  createProjectId(): string { return "project_demo"; }
  createTaskId(): string { return "task_demo"; }
}

test("registers the generated project and creates matching task data", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-demo-"));
  roots.push(root);
  const dataRoot = join(root, "data");
  const registry = new Registry(dataRoot);
  const taskStore = TaskStore.create(dataRoot);
  const creator = new WorkerDemoTaskCreator(
    new GreetingProjectFixture(join(root, ".examples")),
    taskStore,
    registry,
    new FixedIds(),
    () => "2026-08-30T12:00:00Z",
  );

  const created = await creator.create();

  expect(created.task).toEqual({
    id: "task_demo",
    projectId: "project_demo",
    title: "Implement greeting CLI",
    status: "queued",
    createdAt: "2026-08-30T12:00:00Z",
    finishedAt: null,
  });
  expect(registry.projects.get("project_demo")).toMatchObject({
    rootDir: join(root, ".examples", "worker-demo-task_demo"),
  });
  expect(registry.tasks.get("task_demo")).toEqual(created.task);
  expect(readFileSync(taskStore.paths.intent("task_demo"), "utf8")).toBe(DEMO_INTENT);
  expect(readFileSync(taskStore.paths.outcomes("task_demo"), "utf8")).toBe(DEMO_OUTCOMES);
  expect(readFileSync(taskStore.paths.background("task_demo"), "utf8")).toContain("failing acceptance tests");
  expect(created.fixture.baselineCommit).toMatch(/^[0-9a-f]{40,64}$/);

  registry.close();
});
