import { expect, test } from "bun:test";
import { Clock } from "../../infrastructure/system/clock.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { TaskCreator } from "../task-creator.ts";
import { WorkflowProfileLoader } from "../workflow-profiles.ts";

const TIMESTAMP = "2026-09-01T12:00:00Z";
const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";
const POLICY = "```yaml\nprofiles:\n  pi-high:\n    harness: pi\n    model: openai-codex/gpt-5.6-sol\n    thinking: high\ndefaults:\n  plan: pi-high\n  implement: pi-high\n  review: pi-high\n```\n";

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
    WorkflowProfileLoader.createNull(POLICY),
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

test("compiles policy even when task has no profile overrides", async () => {
  // arrange
  const registry = Registry.createNull({
    workspaces: [{ id: "workspace_demo", name: "demo", rootDir: "/demo", createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP, authorizedAt: TIMESTAMP, authorizedBySessionId: "manager" }],
    projects: [{ id: "project_demo", directoryName: "demo", title: "Demo", description: null, createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP }],
  });
  const creator = new TaskCreator(registry, TaskStore.createNull(), new FixedIds(), Clock.createNull(TIMESTAMP), WorkflowProfileLoader.createNull("no profile policy"));

  // act/assert
  await expect(creator.create({ workspaceId: "workspace_demo", projectId: "project_demo", title: "Task", background: "Background" })).rejects.toThrow("exactly one");
  expect(registry.tasks.get(TASK_ID)).toBeUndefined();
});

test("validates and persists named per-purpose profile overrides", async () => {
  // arrange
  const registry = Registry.createNull({
    workspaces: [{ id: "workspace_demo", name: "demo", rootDir: "/demo", createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP, authorizedAt: TIMESTAMP, authorizedBySessionId: "manager" }],
    projects: [{ id: "project_demo", directoryName: "demo", title: "Demo", description: null, createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP }],
  });
  const policy = WorkflowProfileLoader.createNull(POLICY);
  const creator = new TaskCreator(registry, TaskStore.createNull(), new FixedIds(), Clock.createNull(TIMESTAMP), policy);

  // act
  const created = await creator.create({ workspaceId: "workspace_demo", projectId: "project_demo", title: "Task", background: "Background", profileOverrides: { implement: "pi-high" } });

  // assert
  expect(created.task.profileOverrides).toBe('{"implement":"pi-high"}');
  await expect(creator.create({ workspaceId: "workspace_demo", projectId: "project_demo", title: "Bad", background: "Bad", profileOverrides: { implement: "missing" } })).rejects.toThrow("Unknown worker profile");
});
