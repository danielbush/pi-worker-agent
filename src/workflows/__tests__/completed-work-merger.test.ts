import { expect, test } from "bun:test";
import type { Job } from "../../domain/job.ts";
import { CompletedWorkMerger } from "../completed-work-merger.ts";

const TIMESTAMP = "2026-09-03T12:00:00Z";
const COMMIT = "b".repeat(40);

test("inspects completed implementation changes without merging", () => {
  // arrange
  const mergedCommits: string[] = [];
  const merger = CompletedWorkMerger.createNull({
    registry: registryState(),
    mergedCommits,
  });

  // act
  const inspection = merger.inspect("job_implement");

  // assert
  expect(inspection).toMatchObject({
    taskId: "task_demo",
    jobId: "job_implement",
    workspaceName: "demo",
    workspaceRoot: "/workspace/demo",
    changedFiles: ["cursor-canary/index.ts", "cursor-canary/index.test.ts"],
  });
  expect(inspection.diff).toContain("diff --git");
  expect(mergedCommits).toEqual([]);
});

test("commits and merges completed implementation changes", () => {
  // arrange
  const mergedCommits: string[] = [];
  const removedWorktrees: string[] = [];
  const merger = CompletedWorkMerger.createNull({
    registry: registryState(),
    mergedCommits,
    removedWorktrees,
    commit: COMMIT,
  });

  // act
  const result = merger.merge("job_implement");

  // assert
  expect(result).toMatchObject({ commit: COMMIT, worktreeRemoved: true });
  expect(mergedCommits).toEqual([COMMIT]);
  expect(removedWorktrees).toEqual(["/null-worker-agent/worktrees/job_implement"]);
});

test("fails closed when the destination is dirty or stale", () => {
  // arrange
  const dirty = CompletedWorkMerger.createNull({
    registry: registryState(),
    destinationStatus: " M README.md",
  });
  const stale = CompletedWorkMerger.createNull({
    registry: registryState(),
    destinationHead: "c".repeat(40),
  });

  // act / assert
  expect(() => dirty.merge("job_implement")).toThrow("Workspace has uncommitted changes");
  expect(() => stale.merge("job_implement")).toThrow("Workspace HEAD has changed");
});

test("rejects jobs that are not completed implementations", () => {
  // arrange
  const planning = CompletedWorkMerger.createNull({ registry: registryState(job("plan", "completed")) });
  const running = CompletedWorkMerger.createNull({ registry: registryState(job("implement", "running")) });

  // act / assert
  expect(() => planning.inspect("job_implement")).toThrow("Job is not an implementation");
  expect(() => running.inspect("job_implement")).toThrow("Implementation job is not completed");
});

function registryState(implementation = job("implement", "completed")) {
  return {
    workspaces: [{
      id: "workspace_demo",
      name: "demo",
      rootDir: "/workspace/demo",
      createdAt: TIMESTAMP,
      lastUsedAt: TIMESTAMP,
      authorizedAt: TIMESTAMP,
      authorizedBySessionId: "manager-session",
    }],
    tasks: [{
      id: "task_demo",
      workspaceId: "workspace_demo",
      title: "Demo task",
      status: "completed" as const,
      createdAt: TIMESTAMP,
      finishedAt: TIMESTAMP,
    }],
    jobs: [implementation],
  };
}

function job(jobType: string, status: Job["status"]): Job {
  return {
    id: "job_implement",
    taskId: "task_demo",
    jobType,
    parentSessionId: "manager-session",
    parentSessionFile: null,
    harness: "cursor-agent",
    model: "grok-4.5",
    effortLevel: "high",
    modelName: "Grok 4.5",
    modelVersion: "grok-4.5",
    title: "Build Cursor canary",
    status,
    progress: null,
    createdAt: TIMESTAMP,
    finishedAt: status === "completed" ? TIMESTAMP : null,
    bundlePath: "/jobs/job_implement",
    userNotified: true,
    agentNotified: true,
  };
}
