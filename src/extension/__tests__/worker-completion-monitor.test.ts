import { expect, test } from "bun:test";
import type { Job } from "../../domain/job.ts";
import { CompletionNotifications } from "../../infrastructure/pi/completion-notifications.ts";
import { IntervalTimer } from "../../infrastructure/system/interval-timer.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { WorkerCompletionMonitor } from "../worker-completion-monitor.ts";

const TIMESTAMP = "2026-08-30T12:00:00Z";

test("delivers a settled worker result once", async () => {
  // arrange
  const registry = Registry.createNull({
    jobs: [completedJob()],
    workerSessions: [{
      id: "session_plan",
      jobId: "job_plan",
      harnessSessionId: "pi-session",
      harnessSessionPath: null,
      storagePath: "/worker/session-plan",
      createdAt: TIMESTAMP,
    }],
  });
  const taskStore = TaskStore.createNull({
    eventLogs: [{
      taskId: "task_demo",
      jobId: "job_plan",
      workerSessionId: "session_plan",
      events: [{ timestamp: TIMESTAMP, type: "assistant.completed", text: "Change src/index.ts." }],
    }],
  });
  const notifications = CompletionNotifications.createNull();
  const monitor = new WorkerCompletionMonitor(
    registry,
    taskStore,
    notifications,
    IntervalTimer.createNull(),
  );

  // act
  await monitor.pollOnce("manager-session");
  await monitor.pollOnce("manager-session");

  // assert
  expect(notifications.state.user).toEqual([{
    message: "Plan greeting CLI implementation completed for task task_demo.",
    level: "info",
  }]);
  expect(notifications.state.agent).toHaveLength(1);
  expect(notifications.state.agent[0]).toContain("Change src/index.ts.");
  expect(notifications.state.agent[0]).toContain("perform the next required transition");
  expect(notifications.state.agent[0]).not.toContain("ask whether they want to merge it");
  expect(registry.jobs.get("job_plan")).toMatchObject({ userNotified: true, agentNotified: true });
});

test("defers inspection and merge decisions to workflow policy for every job type", async () => {
  // arrange
  const implementation = { ...completedJob(), id: "job_implement", jobTypeId: "implement" };
  const registry = Registry.createNull({
    jobs: [implementation],
    workerSessions: [{
      id: "session_implement",
      jobId: implementation.id,
      harnessSessionId: "pi-session",
      harnessSessionPath: null,
      storagePath: "/worker/session-implement",
      createdAt: TIMESTAMP,
    }],
  });
  const taskStore = TaskStore.createNull({
    eventLogs: [{
      taskId: implementation.taskId,
      jobId: implementation.id,
      workerSessionId: "session_implement",
      events: [{ timestamp: TIMESTAMP, type: "assistant.completed", text: "Implemented." }],
    }],
  });
  const notifications = CompletionNotifications.createNull();
  const monitor = new WorkerCompletionMonitor(registry, taskStore, notifications, IntervalTimer.createNull());

  // act
  await monitor.pollOnce("manager-session");

  // assert
  expect(notifications.state.agent[0]).toContain("WORKFLOW.md decides whether and when");
  expect(notifications.state.agent[0]).not.toContain("implementation is ready");
  expect(notifications.state.agent[0]).not.toContain("ask whether they want to merge");
});

function completedJob(): Job {
  return {
    id: "job_plan",
    taskId: "task_demo",
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
    model: "anthropic/claude-test",
    effortLevel: "high",
    modelName: "Claude Test",
    modelVersion: "claude-test",
    title: "Plan greeting CLI implementation",
    status: "completed",
    progress: "Planning completed",
    createdAt: TIMESTAMP,
    finishedAt: TIMESTAMP,
    bundlePath: "/worker/job-plan",
    userNotified: false,
    agentNotified: false,
  };
}
