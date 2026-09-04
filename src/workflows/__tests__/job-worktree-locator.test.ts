import { expect, test } from "bun:test";
import type { Job } from "../../domain/job.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { JobWorktreeLocator } from "../job-worktree-locator.ts";

const TIMESTAMP = "2026-09-03T12:00:00Z";

test("locates an owned worktree through a dependency without interpreting job-type names", () => {
  // arrange
  const owner = job("job_owner", "draft-change");
  const consumer = job("job_consumer", "inspect-change");
  const registry = Registry.createNull({
    jobTypes: [
      { id: "draft-change", description: null, capabilityProfile: "code", worktreeStrategy: "new-worktree", defaultAgentProfileId: "pi-test", retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
      { id: "inspect-change", description: null, capabilityProfile: "read-only", worktreeStrategy: "dependency-worktree", defaultAgentProfileId: "pi-test", retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
    ],
    jobs: [owner, consumer],
    jobDependencies: [{
      jobId: consumer.id,
      dependsOnJobId: owner.id,
      relationship: "checks",
    }],
  });

  // act
  const path = new JobWorktreeLocator(registry, TaskStore.createNull()).locate(consumer);

  // assert
  expect(path).toBe("/null-worker-agent/worktrees/job_owner");
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
