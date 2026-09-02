import { expect, test } from "bun:test";
import { Clock } from "../../infrastructure/system/clock.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { TaskCreator } from "../task-creator.ts";

const TIMESTAMP = "2026-09-01T12:00:00Z";
const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";

class FixedIds {
  createTaskId(): string { return TASK_ID; }
}

test("creates canonical task files against an authorized workspace", async () => {
  // arrange
  const registry = Registry.createNull({
    workspaces: [{
      id: "workspace_demo",
      name: "pi-worker-agent",
      rootDir: "/projects/pi-worker-agent",
      createdAt: TIMESTAMP,
      lastUsedAt: TIMESTAMP,
      authorizedAt: TIMESTAMP,
      authorizedBySessionId: "manager-session",
    }],
    projects: [{
      id: "project_demo",
      directoryName: "pi-worker-agent",
      title: "Pi worker agent",
      description: null,
      createdAt: TIMESTAMP,
      lastUsedAt: TIMESTAMP,
    }],
  });
  const taskStore = TaskStore.createNull();
  const creator = new TaskCreator(
    registry,
    taskStore,
    new FixedIds(),
    Clock.createNull(TIMESTAMP),
  );

  // act
  const created = await creator.create({
    workspaceId: "workspace_demo",
    projectId: "project_demo",
    title: "Add greeting CLI",
    intent: "Demonstrate task orchestration.",
    outcomes: "- [ ] Greeting works.\n",
    background: "Use the demo workflow.",
  });

  // assert
  expect(created.task).toMatchObject({ id: TASK_ID, workspaceId: "workspace_demo", status: "queued" });
  expect(created.workspace).toMatchObject({ rootDir: "/projects/pi-worker-agent" });
  expect(registry.projectTasks.listTasks("project_demo")).toEqual([created.task]);
  expect(registry.tasks.get(TASK_ID)).toEqual(created.task);
  expect(taskStore.tasks.state).toEqual([{
    taskId: TASK_ID,
    intent: "Demonstrate task orchestration.",
    outcomes: "- [ ] Greeting works.\n",
    background: "Use the demo workflow.",
  }]);
});
