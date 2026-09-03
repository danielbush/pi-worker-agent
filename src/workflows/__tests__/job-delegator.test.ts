import { expect, test } from "bun:test";
import { Clock } from "../../infrastructure/system/clock.ts";
import { DetachedRunnerLauncher, type PreparedRunner } from "../../infrastructure/process/detached-runner-launcher.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { JobDelegator } from "../job-delegator.ts";

const TIMESTAMP = "2026-09-01T12:00:00Z";
const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";

class FailingRunner extends DetachedRunnerLauncher {
  constructor() { super("/null/runner.ts", { which: () => "/null/bin/bun", exists: () => true, spawn: () => { throw new Error("spawn denied"); } }); }
  override launch(_prepared: PreparedRunner, _root: string, _taskId: string, _jobId: string, _sessionId: string): number { throw new Error("spawn denied"); }
}

class FixedIds {
  constructor(
    private readonly jobId = "job_implement",
    private readonly sessionId = "session_implement",
  ) {}

  createJobId(): string { return this.jobId; }
  createWorkerSessionId(): string { return this.sessionId; }
}

test("creates a dependent implementation job with an explicit profile, worktree, and detached launch", async () => {
  // arrange
  const registry = Registry.createNull({
    agentProfiles: [
      { id: "pi-test", description: null, harness: "pi", model: "openai-codex/gpt-5.6-sol", options: '{"thinking":"high"}', retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
      { id: "pi-override", description: null, harness: "pi", model: "openai-codex/gpt-5.6-sol", options: '{"thinking":"high"}', retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
    ],
    jobTypes: [
      { id: "plan", description: null, capabilityProfile: "read-only", worktreeStrategy: "workspace", defaultAgentProfileId: "pi-test", retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
      { id: "implement", description: null, capabilityProfile: "code", worktreeStrategy: "new-worktree", defaultAgentProfileId: "pi-test", retired: false, archiveDate: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
    ],
    workspaces: [{
      id: "workspace_demo",
      name: "pi-worker-agent",
      rootDir: "/projects/pi-worker-agent",
      createdAt: TIMESTAMP,
      lastUsedAt: TIMESTAMP,
    }],
    tasks: [{
      id: TASK_ID,
      workspaceId: "workspace_demo",
      title: "Add greeting CLI",
      status: "completed",
      createdAt: TIMESTAMP,
      finishedAt: TIMESTAMP,
    }],
    jobs: [{
      id: "job_plan",
      taskId: TASK_ID,
      jobTypeId: "plan",
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
      model: "openai-codex/gpt-5.6-sol",
      effortLevel: "high",
      modelName: "Test",
      modelVersion: "test",
      title: "Plan greeting CLI",
      status: "completed",
      progress: "plan completed",
      createdAt: TIMESTAMP,
      finishedAt: TIMESTAMP,
      bundlePath: "/null/plan",
      userNotified: true,
      agentNotified: true,
    }],
  });
  const taskStore = TaskStore.createNull();
  const runner = DetachedRunnerLauncher.createNull(undefined, 4321);
  const worktrees: Array<{ workspaceRoot: string; worktreePath: string }> = [];
  const delegator = new JobDelegator(
    "/data",
    registry,
    taskStore,
    new FixedIds(),
    runner,
    { create: (workspaceRoot, worktreePath) => worktrees.push({ workspaceRoot, worktreePath }) },
    Clock.createNull(TIMESTAMP),
  );

  // act
  const delegated = await delegator.delegate({
    taskId: TASK_ID,
    jobType: "implement",
    agentProfileId: "pi-override",
    title: "Implement greeting CLI",
    request: "Implement the accepted plan.",
    dependsOnJobId: "job_plan",
    relationship: "implements-plan",
    parentSessionId: "manager-session",
    parentSessionFile: "/sessions/manager.jsonl",
  });

  // assert
  expect(delegated).toMatchObject({ pid: 4321, worktreePath: "/null-worker-agent/worktrees/job_implement" });
  expect(worktrees).toEqual([{
    workspaceRoot: "/projects/pi-worker-agent",
    worktreePath: "/null-worker-agent/worktrees/job_implement",
  }]);
  expect(registry.tasks.get(TASK_ID)).toMatchObject({ status: "queued", finishedAt: null });
  expect(registry.jobs.get("job_implement")).toMatchObject({ status: "queued", jobTypeId: "implement", agentProfileId: "pi-override", agentProfileSelectionSource: "explicit" });
  expect(registry.jobDependencies.listForJob("job_implement")).toEqual([{
    jobId: "job_implement",
    dependsOnJobId: "job_plan",
    relationship: "implements-plan",
  }]);
  expect(registry.workerSessions.get("session_implement")).toMatchObject({ jobId: "job_implement" });
  expect(taskStore.jobs.state).toEqual([{
    taskId: TASK_ID,
    jobId: "job_implement",
    request: "Implement the accepted plan.",
  }]);
  expect(runner.state).toEqual([{
    root: "/data",
    taskId: TASK_ID,
    jobId: "job_implement",
    workerSessionId: "session_implement",
  }]);
});

test("settles durable state and records a canonical error when detached spawn fails", async () => {
  // arrange
  const registry = Registry.createNull({
    workspaces: [{ id: "workspace_demo", name: "demo", rootDir: "/projects/demo", createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP }],
    tasks: [{ id: TASK_ID, workspaceId: "workspace_demo", title: "Plan", status: "queued", createdAt: TIMESTAMP, finishedAt: null }],
  });
  const store = TaskStore.createNull();
  const delegator = new JobDelegator("/data", registry, store, new FixedIds("job_plan", "session_plan"), new FailingRunner(), { create: () => {} }, Clock.createNull(TIMESTAMP));

  // act
  const result = delegator.delegate({ taskId: TASK_ID, jobType: "plan", title: "Plan", request: "Plan it", parentSessionId: "manager", parentSessionFile: null });

  // assert
  await expect(result).rejects.toThrow("Detached runner launch failed: spawn denied");
  expect(registry.jobs.get("job_plan")).toMatchObject({ status: "failed", progress: "Detached runner launch failed: spawn denied" });
  expect(registry.tasks.get(TASK_ID)?.status).toBe("failed");
  expect(await store.events(TASK_ID, "job_plan", "session_plan").readAll()).toContainEqual({ timestamp: TIMESTAMP, type: "error", error: "Detached runner launch failed: spawn denied" });
});

test("does not leave a queued orphan when canonical error writing fails after launch failure", async () => {
  // arrange
  const registry = Registry.createNull({
    workspaces: [{ id: "workspace_demo", name: "demo", rootDir: "/projects/demo", createdAt: TIMESTAMP, lastUsedAt: TIMESTAMP }],
    tasks: [{ id: TASK_ID, workspaceId: "workspace_demo", title: "Plan", status: "queued", createdAt: TIMESTAMP, finishedAt: null }],
  });
  const store = TaskStore.createNull({ eventLogs: [{ taskId: TASK_ID, jobId: "job_plan", workerSessionId: "session_plan", appendError: "event disk unavailable" }] });
  const delegator = new JobDelegator("/data", registry, store, new FixedIds("job_plan", "session_plan"), new FailingRunner(), { create: () => {} }, Clock.createNull(TIMESTAMP));

  // act
  const result = delegator.delegate({ taskId: TASK_ID, jobType: "plan", title: "Plan", request: "Plan it", parentSessionId: "manager", parentSessionFile: null });

  // assert
  await expect(result).rejects.toThrow("Detached runner launch failed: spawn denied; canonical error append failed: event disk unavailable");
  expect(registry.jobs.get("job_plan")).toMatchObject({ status: "failed", progress: "Detached runner launch failed: spawn denied" });
  expect(registry.tasks.get(TASK_ID)?.status).toBe("failed");
});

test("creates a read-only review against its implementation dependency's worktree", async () => {
  // arrange
  const registry = Registry.createNull({
    workspaces: [{
      id: "workspace_demo",
      name: "pi-worker-agent",
      rootDir: "/projects/pi-worker-agent",
      createdAt: TIMESTAMP,
      lastUsedAt: TIMESTAMP,
    }],
    tasks: [{
      id: TASK_ID,
      workspaceId: "workspace_demo",
      title: "Add greeting CLI",
      status: "running",
      createdAt: TIMESTAMP,
      finishedAt: null,
    }],
    jobs: [{
      id: "job_implement",
      taskId: TASK_ID,
      jobTypeId: "implement",
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
      model: "openai-codex/gpt-5.6-sol",
      effortLevel: "high",
      modelName: "Test",
      modelVersion: "test",
      title: "Implement greeting CLI",
      status: "completed",
      progress: "implement completed",
      createdAt: TIMESTAMP,
      finishedAt: TIMESTAMP,
      bundlePath: "/jobs/job_implement",
      userNotified: true,
      agentNotified: true,
    }],
  });
  const taskStore = TaskStore.createNull();
  const createdWorktrees: string[] = [];
  const delegator = new JobDelegator(
    "/data",
    registry,
    taskStore,
    new FixedIds("job_review", "session_review"),
    DetachedRunnerLauncher.createNull(undefined, 4321),
    { create: (_workspaceRoot, worktreePath) => createdWorktrees.push(worktreePath) },
    Clock.createNull(TIMESTAMP),
  );

  // act
  const delegated = await delegator.delegate({
    taskId: TASK_ID,
    jobType: "review",
    title: "Review greeting CLI",
    request: "Review the implementation read-only.",
    dependsOnJobId: "job_implement",
    relationship: "reviews",
    parentSessionId: "manager-session",
    parentSessionFile: "/sessions/manager.jsonl",
  });

  // assert
  expect(delegated.worktreePath).toBe("/null-worker-agent/worktrees/job_implement");
  expect(createdWorktrees).toEqual([]);
  expect(registry.jobs.get("job_review")).toMatchObject({ jobTypeId: "review", status: "queued" });
  expect(registry.jobDependencies.listForJob("job_review")).toEqual([{
    jobId: "job_review",
    dependsOnJobId: "job_implement",
    relationship: "reviews",
  }]);
});
