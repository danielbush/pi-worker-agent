import { expect, test } from "bun:test";
import type { Job } from "../../domain/job.ts";
import { Registry } from "../../storage/registry.ts";
import { ExecutionCatalogManager } from "../execution-catalog-manager.ts";

const NOW = "2026-09-10T12:00:00.000Z";

test("creates binding profiles and job types and preserves them through retirement", () => {
  // arrange
  const registry = Registry.createNull({ agentProfiles: [], jobTypes: [] });
  const manager = ExecutionCatalogManager.createNull(registry, NOW);

  // act
  const profile = manager.createAgentProfile({ id: "pi-high", harness: "pi", model: "openai-codex/gpt-5.6-sol", options: { thinking: "high" } });
  expect(manager.updateAgentProfile("pi-high", "pi", "openai-codex/gpt-5.6-sol", { thinking: "medium" }).options).toBe('{"thinking":"medium"}');
  const jobType = manager.createJobType({ id: "plan", capabilityProfile: "read-only", worktreeStrategy: "workspace", defaultAgentProfileId: profile.id });

  // assert
  expect(jobType.defaultAgentProfileId).toBe("pi-high");
  expect(() => manager.updateAgentProfile("pi-high", "pi", "another/model", { thinking: "high" })).toThrow("immutable");
  expect(() => manager.retireAgentProfile("pi-high")).toThrow("active default");
  expect(manager.retireJobType("plan")).toMatchObject({ retired: true, archiveDate: NOW });
  expect(manager.retireAgentProfile("pi-high")).toMatchObject({ retired: true, archiveDate: NOW });
  expect(() => manager.reactivateJobType("plan")).toThrow("Agent profile is retired");
  expect(manager.reactivateAgentProfile("pi-high")).toMatchObject({ retired: false, archiveDate: null });
  expect(manager.reactivateJobType("plan")).toMatchObject({ retired: false, archiveDate: null });
});

test("allows job-type changes after referenced jobs settle but not while they are active", () => {
  // arrange
  const registry = Registry.createNull({
    tasks: [{ id: "task", workspaceId: null, title: "Task", status: "running", createdAt: NOW, finishedAt: null }],
    jobs: [job("running")],
  });
  const manager = ExecutionCatalogManager.createNull(registry, NOW);

  // act/assert
  expect(() => manager.updateJobType("plan", "test", "new-worktree", "pi-test")).toThrow("active jobs");
  registry.jobs.updateStatus("job", "completed", null, NOW);
  expect(manager.updateJobType("plan", "test", "new-worktree", "pi-test")).toMatchObject({
    capabilityProfile: "test",
    worktreeStrategy: "new-worktree",
  });
});

test("rejects incomplete execution configuration", () => {
  // arrange
  const manager = ExecutionCatalogManager.createNull(Registry.createNull({ agentProfiles: [], jobTypes: [] }), NOW);

  // act/assert
  expect(() => manager.createAgentProfile({ id: "bad", harness: "pi", model: "model", options: {} })).toThrow("missing thinking");
  expect(() => manager.createAgentProfile({ id: "bad", harness: "cursor-agent", model: "model", options: { thinking: "high" } })).toThrow("unsupported cursor-agent option");
  expect(() => manager.createJobType({ id: "plan", capabilityProfile: "read-only", worktreeStrategy: "workspace", defaultAgentProfileId: "missing" })).toThrow("Unknown agent profile");
});

function job(status: Job["status"]): Job {
  return {
    id: "job", taskId: "task", jobTypeId: "plan", agentProfileId: "pi-test",
    agentProfileSelectionSource: "migration-fossil", parentSessionId: "manager", parentSessionFile: null,
    snapshotProvenance: "migration-fossil", profileFingerprint: null, profileOptions: null,
    capabilityProfile: null, harness: "pi", harnessVersion: null, nativeInvocation: null,
    model: "test", effortLevel: "", modelName: "test", modelVersion: "test",
    title: "Job", status, progress: null, createdAt: NOW,
    finishedAt: status === "completed" ? NOW : null, bundlePath: "/job",
    userNotified: false, agentNotified: false,
  };
}
