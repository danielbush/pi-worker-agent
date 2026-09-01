import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/storage/task-store.ts";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";

const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

test("composes task, job, and worker-session storage", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-store-"));
  roots.push(root);
  const store = TaskStore.create(root);

  await store.tasks.create({
    taskId: TASK_ID,
    intent: "Keep the greeting friendly.",
    background: "A small Bun project.",
  });
  await store.jobs.create({
    taskId: TASK_ID,
    jobId: "job_plan",
    request: "Plan the greeting CLI.",
  });

  expect(store.paths.task(TASK_ID)).toBe(join(root, "tasks", "ab", TASK_ID));
  expect(readFileSync(store.paths.intent(TASK_ID), "utf8")).toBe("Keep the greeting friendly.");
  expect(readFileSync(store.paths.background(TASK_ID), "utf8")).toBe("A small Bun project.");
  expect(existsSync(store.paths.outcomes(TASK_ID))).toBe(false);
  expect(readFileSync(store.paths.request(TASK_ID, "job_plan"), "utf8")).toBe("Plan the greeting CLI.");
  expect(store.paths.worktree("job_plan")).toBe(join(root, "worktrees", "job_plan"));

  const events = store.events(TASK_ID, "job_plan", "session_test");
  await events.create();
  await events.append({ timestamp: "2026-08-30T12:00:00Z", type: "session.started", pid: 123 });
  await events.append({ timestamp: "2026-08-30T12:00:01Z", type: "assistant.text", text: "Planning" });

  expect(await events.readAll()).toEqual([
    { timestamp: "2026-08-30T12:00:00Z", type: "session.started", pid: 123 },
    { timestamp: "2026-08-30T12:00:01Z", type: "assistant.text", text: "Planning" },
  ]);
});
