import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GreetingProjectFixture } from "../../src/demo/greeting-project-fixture.ts";
import { Clock } from "../../src/infrastructure/system/clock.ts";
import {
  DEMO_INTENT,
  DEMO_OUTCOMES,
  WorkerDemoTaskCreator,
} from "../../src/workflows/worker-demo-task-creator.ts";
import { Registry } from "../../src/storage/registry.ts";
import { TaskStore } from "../../src/storage/task-store.ts";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";

const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

class FixedIds {
  createProjectId(): string { return "project_demo"; }
  createTaskId(): string { return TASK_ID; }
}

test("registers the generated project and creates matching task data", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-demo-"));
  roots.push(root);
  const dataRoot = join(root, "data");
  const registry = Registry.create(dataRoot);
  const taskStore = TaskStore.create(dataRoot);
  const creator = new WorkerDemoTaskCreator(
    GreetingProjectFixture.create(join(root, ".examples")),
    taskStore,
    registry,
    new FixedIds(),
    Clock.createNull("2026-08-30T12:00:00Z"),
  );

  const created = await creator.create();

  expect(created.task).toEqual({
    id: TASK_ID,
    projectId: "project_demo",
    title: "Implement greeting CLI",
    status: "queued",
    createdAt: "2026-08-30T12:00:00Z",
    finishedAt: null,
  });
  expect(registry.projects.get("project_demo")).toMatchObject({
    rootDir: join(root, ".examples", `worker-demo-${TASK_ID}`),
  });
  expect(registry.tasks.get(TASK_ID)).toEqual(created.task);
  expect(readFileSync(taskStore.paths.intent(TASK_ID), "utf8")).toBe(DEMO_INTENT);
  expect(readFileSync(taskStore.paths.outcomes(TASK_ID), "utf8")).toBe(DEMO_OUTCOMES);
  expect(readFileSync(taskStore.paths.background(TASK_ID), "utf8")).toContain("failing acceptance tests");
  expect(created.fixture.baselineCommit).toMatch(/^[0-9a-f]{40,64}$/);

  registry.close();
});
