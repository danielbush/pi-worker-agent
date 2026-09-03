import { expect, test } from "bun:test";
import type { Job } from "../../domain/job.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { JobWorktreeLocator } from "../job-worktree-locator.ts";

const TIMESTAMP = "2026-09-03T12:00:00Z";

test("locates the implementation worktree through a review dependency", () => {
  // arrange
  const implementation = job("job_implementation", "implement");
  const review = job("job_review", "review");
  const registry = Registry.createNull({
    jobs: [implementation, review],
    jobDependencies: [{
      jobId: review.id,
      dependsOnJobId: implementation.id,
      relationship: "reviews",
    }],
  });

  // act
  const path = new JobWorktreeLocator(registry, TaskStore.createNull()).locate(review);

  // assert
  expect(path).toBe("/null-worker-agent/worktrees/job_implementation");
});

function job(id: string, jobTypeId: Job["jobTypeId"]): Job {
  return {
    id,
    taskId: "task_review",
    jobTypeId,
    agentProfileId: "pi-test",
    agentProfileSelectionSource: "migration-fossil",
    parentSessionId: "manager-session",
    parentSessionFile: null,
    snapshotProvenance: "migration-fossil",
    profileFingerprint: null,
    profileOptions: null,
    capabilityProfile: null,
    harness: "pi",
    harnessVersion: null,
    nativeInvocation: null,
    model: "anthropic/test",
    effortLevel: "high",
    modelName: "Test",
    modelVersion: "test",
    title: id,
    status: "completed",
    progress: `${jobTypeId} completed`,
    createdAt: TIMESTAMP,
    finishedAt: TIMESTAMP,
    bundlePath: `/jobs/${id}`,
    userNotified: true,
    agentNotified: true,
  };
}
