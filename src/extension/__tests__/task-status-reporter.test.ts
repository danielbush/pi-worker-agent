import { expect, test } from "bun:test";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { formatTaskStatus, TaskStatusReporter } from "../task-status-reporter.ts";

const TIMESTAMP = "2026-08-30T12:00:00Z";

test("emits manager-visible status from nulled worker state", async () => {
  // arrange
  const registry = Registry.createNull({
    tasks: [{
      id: "task_demo",
      workspaceId: "project_demo",
      title: "Implement greeting CLI",
      status: "running",
      createdAt: TIMESTAMP,
      finishedAt: null,
    }],
    jobs: [{
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
      bundlePath: "/null-worker-agent/tasks/ta/task_demo/jobs/job_plan",
      userNotified: true,
      agentNotified: true,
    }],
    workerSessions: [{
      id: "session_plan",
      jobId: "job_plan",
      harnessSessionId: "pi-session",
      harnessSessionPath: null,
      storagePath: "/null-worker-agent/session-plan",
      createdAt: TIMESTAMP,
    }],
  });
  const taskStore = TaskStore.createNull({
    eventLogs: [{
      taskId: "task_demo",
      jobId: "job_plan",
      workerSessionId: "session_plan",
      events: [{
        timestamp: TIMESTAMP,
        type: "assistant.completed",
        text: "Change src/index.ts and run bun test.",
      }],
    }],
  });
  const reporter = new TaskStatusReporter(registry, taskStore);

  // act
  const status = await reporter.inspect("task_demo");

  // assert
  expect(status).toEqual({
    id: "task_demo",
    title: "Implement greeting CLI",
    status: "running",
    jobs: [{
      id: "job_plan",
      type: "plan",
      title: "Plan greeting CLI implementation",
      status: "completed",
      progress: "Planning completed",
      workerSessionId: "session_plan",
      worktreePath: null,
      requestPath: "/null-worker-agent/tasks/ta/task_demo/jobs/job_plan/request.md",
      eventsPath: "/null-worker-agent/tasks/ta/task_demo/jobs/job_plan/worker-sessions/session_plan/events.jsonl",
      result: "Change src/index.ts and run bun test.",
      workerProfile: null,
      profileFingerprint: null,
      profileOptions: null,
      capabilityProfile: null,
      harness: "pi",
      harnessVersion: null,
      nativeInvocation: null,
    }],
  });
  expect(formatTaskStatus(status!)).toContain(
    "job_plan | Plan greeting CLI implementation | completed",
  );
  expect(formatTaskStatus(status!)).toContain("Use --verbose for progress, artifact paths");
  expect(formatTaskStatus(status!)).not.toContain("Worker session:");
  expect(formatTaskStatus(status!)).not.toContain("Change src/index.ts and run bun test.");
  expect(formatTaskStatus(status!, { includeResults: true }))
    .toContain("Result:\nChange src/index.ts and run bun test.");
});
