import { expect, test } from "bun:test";
import type { Job } from "../../domain/job.ts";
import { CompletedWorkMerger } from "../completed-work-merger.ts";

const TIMESTAMP = "2026-09-03T12:00:00Z";
const COMMIT = "b".repeat(40);

test("inspects completed job-owned changes without interpreting the job-type name", () => {
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

test("commits and merges completed job-owned changes", () => {
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

test("rejects jobs that do not own a worktree or are not completed", () => {
  // arrange
  const workspaceJob = CompletedWorkMerger.createNull({ registry: registryState(job("research", "completed")) });
  const running = CompletedWorkMerger.createNull({ registry: registryState(job("deliverable", "running")) });

  // act / assert
  expect(() => workspaceJob.inspect("job_implement")).toThrow("Job does not own a worktree");
  expect(() => running.inspect("job_implement")).toThrow("Job is not completed");
});

function registryState(work = job("deliverable", "completed")) {
  return {
    jobTypes: [
      { id: "deliverable", description: null, capabilityProfile: "code" as const, worktreeStrategy: "new-worktree" as const, defaultAgentProfileId: "pi-test", retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
      { id: "research", description: null, capabilityProfile: "read-only" as const, worktreeStrategy: "workspace" as const, defaultAgentProfileId: "pi-test", retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
    ],
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
    jobs: [work],
  };
}

function job(jobTypeId: string, status: Job["status"]): Job {
  return {
    id: "job_implement",
    taskId: "task_demo",
    jobTypeId,
    agentProfileId: "pi-test",
    agentProfileSelectionSource: "migration-fossil",
    parentSessionId: "manager-session",
    parentSessionFile: null,
    snapshotProvenance: "migration-fossil",
    profileFingerprint: null,
    profileOptions: null,
    capabilityProfile: null,
    harness: "cursor-agent",
    harnessVersion: null,
    nativeInvocation: null,
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
