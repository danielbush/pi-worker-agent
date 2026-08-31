import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/storage/task-store.ts";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

test("composes task, job, and worker-session storage", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-store-"));
  roots.push(root);
  const store = TaskStore.create(root);

  await store.tasks.create({
    taskId: "task_test",
    intent: "Keep the greeting friendly.",
    background: "A small Bun project.",
  });
  await store.jobs.create({
    taskId: "task_test",
    jobId: "job_plan",
    request: "Plan the greeting CLI.",
  });

  expect(readFileSync(store.paths.intent("task_test"), "utf8")).toBe("Keep the greeting friendly.");
  expect(readFileSync(store.paths.background("task_test"), "utf8")).toBe("A small Bun project.");
  expect(existsSync(store.paths.outcomes("task_test"))).toBe(false);
  expect(readFileSync(store.paths.request("task_test", "job_plan"), "utf8")).toBe("Plan the greeting CLI.");
  expect(store.paths.worktree("job_plan")).toBe(join(root, "worktrees", "job_plan"));

  const events = store.events("task_test", "job_plan", "session_test");
  await events.create();
  await events.append({ timestamp: "2026-08-30T12:00:00Z", type: "session.started", pid: 123 });
  await events.append({ timestamp: "2026-08-30T12:00:01Z", type: "assistant.text", text: "Planning" });

  expect(await events.readAll()).toEqual([
    { timestamp: "2026-08-30T12:00:00Z", type: "session.started", pid: 123 },
    { timestamp: "2026-08-30T12:00:01Z", type: "assistant.text", text: "Planning" },
  ]);
});
