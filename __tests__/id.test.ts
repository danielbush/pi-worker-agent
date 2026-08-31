import { expect, test } from "bun:test";
import { Id } from "../src/domain/id.ts";

test("creates prefixed construct IDs", () => {
  const id = Id.create();

  expect(id.createProjectId()).toMatch(/^project_[0-9a-f-]+$/);
  expect(id.createTaskId()).toMatch(/^task_[0-9a-f-]+$/);
  expect(id.createJobId()).toMatch(/^job_[0-9a-f-]+$/);
  expect(id.createWorkerSessionId()).toMatch(/^session_[0-9a-f-]+$/);
});
