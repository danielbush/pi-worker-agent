import { expect, test } from "bun:test";
import type { AgentProfile } from "../../domain/agent-profile.ts";
import type { JobTypeConfiguration } from "../../domain/job-type.ts";
import { Clock } from "../../infrastructure/system/clock.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { TaskCreator } from "../task-creator.ts";

const TIMESTAMP = "2026-09-01T12:00:00Z";
const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";
class FixedIds { createTaskId(): string { return TASK_ID; } }

function state(configured = true) {
  return {
    workspaces: [{ id: "workspace_demo", name: "demo", rootDir: "/demo", createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP, authorizedAt: TIMESTAMP, authorizedBySessionId: "manager" }],
    projects: [{ id: "project_demo", directoryName: "demo", title: "Demo", description: null, createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP }],
    agentProfiles: configured ? [{ id: "pi-high", description: null, harness: "pi", model: "openai-codex/gpt-5.6-sol", options: '{"thinking":"high"}', retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP } satisfies AgentProfile] : [],
    jobTypes: configured ? [{ id: "implement", description: null, capabilityProfile: "code", worktreeStrategy: "new-worktree", defaultAgentProfileId: "pi-high", retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP } satisfies JobTypeConfiguration] : [],
  };
}

test("creates canonical task files against an authorized workspace", async () => {
  // arrange
  const registry = Registry.createNull(state());
  const taskStore = TaskStore.createNull();
  const creator = new TaskCreator(registry, taskStore, new FixedIds(), Clock.createNull(TIMESTAMP));

  // act
  const created = await creator.create({
    workspaceId: "workspace_demo", projectId: "project_demo", title: "Add greeting CLI",
    intent: "Demonstrate task orchestration.", outcomes: "- [ ] Greeting works.\n", background: "Use the demo workflow.",
  });

  // assert
  expect(created.task).toMatchObject({ id: TASK_ID, workspaceId: "workspace_demo", status: "queued" });
  expect(created.workspace).toMatchObject({ rootDir: "/demo" });
  expect(registry.projectTasks.listTasks("project_demo")).toEqual([created.task]);
  expect(registry.tasks.get(TASK_ID)).toEqual(created.task);
  expect(taskStore.tasks.state).toEqual([{ taskId: TASK_ID, intent: "Demonstrate task orchestration.", outcomes: "- [ ] Greeting works.\n", background: "Use the demo workflow." }]);
});

test("requires active execution configuration before task work", async () => {
  // arrange
  const registry = Registry.createNull(state(false));
  const creator = new TaskCreator(registry, TaskStore.createNull(), new FixedIds(), Clock.createNull(TIMESTAMP));

  // act/assert
  await expect(creator.create({ workspaceId: "workspace_demo", projectId: "project_demo", title: "Task", background: "Background" })).rejects.toThrow("no active job types");
  expect(registry.tasks.get(TASK_ID)).toBeUndefined();
});
