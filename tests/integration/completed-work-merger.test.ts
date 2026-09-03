import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "../../src/domain/job.ts";
import { GitRepository } from "../../src/infrastructure/git/git-repository.ts";
import { Registry } from "../../src/storage/registry.ts";
import { CompletedWorkMerger } from "../../src/workflows/completed-work-merger.ts";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

test("merges a completed implementation worktree into a clean workspace", async () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-merge-"));
  roots.push(root);
  const workspaceRoot = join(root, "workspace");
  const worktreeRoot = join(root, "worktree");
  mkdirSync(workspaceRoot);
  writeFileSync(join(workspaceRoot, "README.md"), "# Demo\n");
  const workspaceGit = GitRepository.create(workspaceRoot);
  workspaceGit.initializeWithBaseline("Initial commit");
  workspaceGit.createWorktree(worktreeRoot);
  mkdirSync(join(worktreeRoot, "cursor-canary"));
  writeFileSync(join(worktreeRoot, "cursor-canary", "index.ts"), 'console.log("Cursor SDK OK");\n');

  const registry = Registry.createNull({
    workspaces: [{
      id: "workspace_demo",
      name: "Demo",
      rootDir: workspaceRoot,
      createdAt: "2026-09-03T12:00:00Z",
      lastUsedAt: "2026-09-03T12:00:00Z",
      authorizedAt: "2026-09-03T12:00:00Z",
      authorizedBySessionId: "manager-session",
    }],
    tasks: [{
      id: "task_demo",
      workspaceId: "workspace_demo",
      title: "Demo",
      status: "completed",
      createdAt: "2026-09-03T12:00:00Z",
      finishedAt: "2026-09-03T13:00:00Z",
    }],
    jobs: [implementationJob()],
  });
  const merger = new CompletedWorkMerger(
    registry,
    () => worktreeRoot,
    { open: (path) => GitRepository.create(path) },
  );

  // act
  const inspection = merger.inspect("job_implement");
  const merged = merger.merge("job_implement");

  // assert
  expect(inspection.changedFiles).toEqual(["cursor-canary/index.ts"]);
  expect(inspection.diff).toContain('+console.log("Cursor SDK OK");');
  expect(await Bun.file(join(workspaceRoot, "cursor-canary", "index.ts")).text()).toBe('console.log("Cursor SDK OK");\n');
  expect(workspaceGit.status()).toBe("");
  expect(merged).toMatchObject({ worktreeRemoved: true });
  expect(merged.commit).toMatch(/^[a-f0-9]{40}$/);
  expect(existsSync(worktreeRoot)).toBe(false);
  const message = Bun.spawnSync(["git", "log", "-1", "--format=%B"], { cwd: workspaceRoot }).stdout.toString();
  expect(message).toContain("Job: job_implement");
});

function implementationJob(): Job {
  return {
    id: "job_implement",
    taskId: "task_demo",
    jobType: "implement",
    parentSessionId: "manager-session",
    parentSessionFile: null,
    harness: "cursor-agent",
    model: "grok-4.5",
    effortLevel: "high",
    modelName: "Grok 4.5",
    modelVersion: "grok-4.5",
    title: "Build Cursor canary",
    status: "completed",
    progress: "implement completed",
    createdAt: "2026-09-03T12:00:00Z",
    finishedAt: "2026-09-03T13:00:00Z",
    bundlePath: "/jobs/job_implement",
    userNotified: true,
    agentNotified: true,
  };
}
