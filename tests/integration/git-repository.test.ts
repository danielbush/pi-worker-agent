import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";
import { GitRepository } from "../../src/infrastructure/git/git-repository.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

test("resolves the Git executable before spawning it", () => {
  // arrange
  let spawnedCommand: string[] = [];
  const repository = new GitRepository("/workspace", {
    which: () => "/resolved/bin/git",
    spawnSync: (command) => {
      spawnedCommand = command;
      return {
        exitCode: 0,
        stdout: { toString: () => "" },
        stderr: { toString: () => "" },
      };
    },
    mkdirSync: () => undefined,
  });

  // act
  repository.status();

  // assert
  expect(spawnedCommand).toEqual(["/resolved/bin/git", "status", "--porcelain"]);
});

test("creates an isolated worktree and its parent directories", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-git-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  const worktree = join(root, "nested", "worktrees", "job_test");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "baseline\n");
  const repository = GitRepository.create(workspace);
  repository.initializeWithBaseline("Create baseline");

  // act
  repository.createWorktree(worktree);

  // assert
  expect(existsSync(join(worktree, "README.md"))).toBe(true);
  expect(GitRepository.create(worktree).status()).toBe("");
});
