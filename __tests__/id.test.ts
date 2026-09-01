import { expect, test } from "bun:test";
import { Id } from "../src/domain/id.ts";

test("creates construct IDs, using a bare UUID for tasks", () => {
  const id = Id.create();

  expect(id.createProjectId()).toMatch(/^project_[0-9a-f-]+$/);
  expect(id.createTaskId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(id.createJobId()).toMatch(/^job_[0-9a-f-]+$/);
  expect(id.createWorkerSessionId()).toMatch(/^session_[0-9a-f-]+$/);
});
