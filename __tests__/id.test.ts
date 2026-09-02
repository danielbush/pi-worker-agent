import { expect, test } from "bun:test";
import { Id, resolveIdReference } from "../src/domain/id.ts";

test("creates construct IDs, using a bare UUID for tasks", () => {
  const id = Id.create();

  expect(id.createProjectId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(id.createWorkspaceId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(id.createTaskId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(id.createJobId()).toMatch(/^job_[0-9a-f-]+$/);
  expect(id.createWorkerSessionId()).toMatch(/^session_[0-9a-f-]+$/);
});

test("resolves unique ID shorthand and rejects ambiguous shorthand", () => {
  const records = [
    { id: "abcd1234-0000-4000-8000-000000000000" },
    { id: "abcd5678-0000-4000-8000-000000000000" },
  ];

  expect(resolveIdReference("abcd1", records, "project")).toEqual(records[0]);
  expect(() => resolveIdReference("abcd", records, "project")).toThrow("Ambiguous project ID shorthand");
  expect(() => resolveIdReference("abc", records, "project")).toThrow("at least 4 characters");
});
