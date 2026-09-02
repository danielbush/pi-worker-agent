import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";
import { WorkspaceDirectory } from "../../src/infrastructure/filesystem/workspace-directory.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

test("preflights and materializes a user-approved missing workspace", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-workspace-directory-"));
  roots.push(root);
  const path = join(root, "nested", "workspace");
  const directories = WorkspaceDirectory.create(root);

  // act
  const preflight = directories.inspect(path);
  const materialized = directories.materialize(preflight, true);

  // assert
  expect(preflight).toMatchObject({ exists: false, gitRepository: false });
  expect(materialized).toBe(preflight.canonicalPath);
  expect(directories.inspect(path).exists).toBe(true);
  expect(directories.state.creations).toEqual([preflight.canonicalPath]);
});

test("recognizes an existing Git workspace without modifying it", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-workspace-directory-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  const directories = WorkspaceDirectory.create(root);

  // act
  const preflight = directories.inspect(root);

  // assert
  expect(preflight).toMatchObject({ exists: true, gitRepository: true });
  expect(directories.state.creations).toEqual([]);
});
