import { expect, test } from "bun:test";
import { Clock } from "../../infrastructure/system/clock.ts";
import { DetachedRunnerLauncher } from "../../infrastructure/process/detached-runner-launcher.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { JobDelegator } from "../job-delegator.ts";

const TIMESTAMP = "2026-09-01T12:00:00Z";
const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";

class FixedIds {
  constructor(
    private readonly jobId = "job_implement",
    private readonly sessionId = "session_implement",
  ) {}

  createJobId(): string { return this.jobId; }
  createWorkerSessionId(): string { return this.sessionId; }
}

test("creates a dependent implementation job, worktree, and detached launch", async () => {
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
      status: "completed",
      createdAt: TIMESTAMP,
      finishedAt: TIMESTAMP,
    }],
    jobs: [{
      id: "job_plan",
      taskId: TASK_ID,
      jobType: "plan",
      parentSessionId: "manager-session",
      parentSessionFile: null,
      harness: "pi",
      model: "anthropic/test",
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
    title: "Implement greeting CLI",
    request: "Implement the accepted plan.",
    dependsOnJobId: "job_plan",
    relationship: "implements-plan",
    parentSessionId: "manager-session",
    parentSessionFile: "/sessions/manager.jsonl",
    model: "anthropic/test",
    modelName: "Test",
    modelVersion: "test",
    effortLevel: "high",
  });

  // assert
  expect(delegated).toMatchObject({ pid: 4321, worktreePath: "/null-worker-agent/worktrees/job_implement" });
  expect(worktrees).toEqual([{
    workspaceRoot: "/projects/pi-worker-agent",
    worktreePath: "/null-worker-agent/worktrees/job_implement",
  }]);
  expect(registry.tasks.get(TASK_ID)).toMatchObject({ status: "queued", finishedAt: null });
  expect(registry.jobs.get("job_implement")).toMatchObject({ status: "queued", jobType: "implement" });
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
      jobType: "implement",
      parentSessionId: "manager-session",
      parentSessionFile: null,
      harness: "pi",
      model: "anthropic/test",
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
    model: "anthropic/test",
    modelName: "Test",
    modelVersion: "test",
    effortLevel: "high",
  });

  // assert
  expect(delegated.worktreePath).toBe("/null-worker-agent/worktrees/job_implement");
  expect(createdWorktrees).toEqual([]);
  expect(registry.jobs.get("job_review")).toMatchObject({ jobType: "review", status: "queued" });
  expect(registry.jobDependencies.listForJob("job_review")).toEqual([{
    jobId: "job_review",
    dependsOnJobId: "job_implement",
    relationship: "reviews",
  }]);
});
