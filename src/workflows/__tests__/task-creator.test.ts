import { expect, test } from "bun:test";
import { Clock } from "../../infrastructure/system/clock.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { TaskCreator } from "../task-creator.ts";

const TIMESTAMP = "2026-09-01T12:00:00Z";
const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";

class FixedIds {
  createProjectId(): string { return "project_demo"; }
  createTaskId(): string { return TASK_ID; }
}

test("creates canonical task files and registers its workspace", async () => {
  // arrange
  const registry = Registry.createNull();
  const taskStore = TaskStore.createNull();
  const creator = new TaskCreator(
    registry,
    taskStore,
    new FixedIds(),
    Clock.createNull(TIMESTAMP),
  );

  // act
  const created = await creator.create({
    workspaceRoot: "/projects/pi-worker-agent",
    workspaceName: "pi-worker-agent",
    title: "Add greeting CLI",
    intent: "Demonstrate task orchestration.",
    outcomes: "- [ ] Greeting works.\n",
    background: "Use the demo workflow.",
  });

  // assert
  expect(created.task).toMatchObject({ id: TASK_ID, projectId: "project_demo", status: "queued" });
  expect(registry.projects.get("project_demo")).toMatchObject({ rootDir: "/projects/pi-worker-agent" });
  expect(registry.tasks.get(TASK_ID)).toEqual(created.task);
  expect(taskStore.tasks.state).toEqual([{
    taskId: TASK_ID,
    intent: "Demonstrate task orchestration.",
    outcomes: "- [ ] Greeting works.\n",
    background: "Use the demo workflow.",
  }]);
});
