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
  expect(registry.jobs.get("job_plan")).toMatchObject({ userNotified: true, agentNotified: true });
});

function completedJob(): Job {
  return {
    id: "job_plan",
    taskId: "task_demo",
    jobType: "plan",
    parentSessionId: "manager-session",
    parentSessionFile: null,
    harness: "pi",
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
