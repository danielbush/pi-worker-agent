import { expect, test } from "bun:test";
import type { Job } from "../../domain/job.ts";
import { PiHarness } from "../../infrastructure/pi/pi-harness.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { Clock } from "../../infrastructure/system/clock.ts";
import { PiWorkerRunner, reportedWorkerFailure, toolsForJob } from "../pi-worker-runner.ts";

const TIMESTAMP = "2026-08-30T12:00:00Z";
const REQUEST = "Inspect the project and produce an implementation plan.";

test("completes a planning job from Pi output", async () => {
  // arrange
  const registry = createRegistry();
  const taskStore = createTaskStore();
  const harness = PiHarness.createNull({
    pid: 1234,
    stdoutLines: piOutput({
      content: "Change src/index.ts.",
      stopReason: "stop",
    }),
  });
  const runner = new PiWorkerRunner(registry, taskStore, harness, Clock.createNull(TIMESTAMP));

  // act
  const exitCode = await runner.execute(input());

  // assert
  expect(exitCode).toBe(0);
  expect(registry.jobs.get("job_plan")).toMatchObject({ status: "completed", progress: "plan completed" });
  expect(registry.tasks.get("task_demo")).toMatchObject({
    status: "running",
    finishedAt: null,
  });
  expect(registry.workerSessions.get("session_plan")).toMatchObject({
    harnessSessionId: "pi-native-session",
    harnessSessionPath: null,
  });
  expect(harness.state.invocations).toEqual([{
    cwd: "/projects/greeting",
    model: "anthropic/claude-test",
    effortLevel: "high",
    tools: ["read", "grep", "find", "ls"],
    prompt: REQUEST,
    sessionDirectory: "/worker/session-plan/pi-session",
    temporaryDirectory: "/worker/session-plan/pi-session/tmp",
    writablePaths: [
      "/worker/session-plan/pi-session",
      "/worker/session-plan/pi-session/tmp",
    ],
  }]);
  expect((await taskStore.events("task_demo", "job_plan", "session_plan").readAll()).map((event) => event.type))
    .toEqual([
      "session.started",
      "prompt",
      "assistant.started",
      "assistant.text",
      "assistant.completed",
      "session.completed",
    ]);
});

test("confines an implementation worker to its worktree and session directories", async () => {
  // arrange
  const registry = createRegistry({ ...planningJob(), jobType: "implement" });
  const taskStore = createTaskStore();
  const harness = PiHarness.createNull({
    stdoutLines: piOutput({ content: "Implemented.", stopReason: "stop" }),
  });
  const runner = new PiWorkerRunner(registry, taskStore, harness, Clock.createNull(TIMESTAMP));

  // act
  const exitCode = await runner.execute(input());

  // assert
  expect(exitCode).toBe(0);
  expect(harness.state.invocations[0]).toMatchObject({
    cwd: "/null-worker-agent/worktrees/job_plan",
    writablePaths: [
      "/worker/session-plan/pi-session",
      "/worker/session-plan/pi-session/tmp",
      "/null-worker-agent/worktrees/job_plan",
    ],
  });
});

test("selects writable tools for implementation and recognizes reported failure", () => {
  expect(toolsForJob("implement")).toEqual(["read", "grep", "find", "ls", "write", "edit", "bash"]);
  expect(reportedWorkerFailure("Unable to implement because tools are read-only.\n\nNo files changed."))
    .toBe("Unable to implement because tools are read-only.");
  expect(reportedWorkerFailure("Implemented the requested change.")).toBeUndefined();
});

test("fails when Pi reports an assistant error despite exiting zero", async () => {
  // arrange
  const registry = createRegistry();
  const taskStore = createTaskStore();
  const harness = PiHarness.createNull({
    stdoutLines: piOutput({
      content: "",
      stopReason: "error",
      errorMessage: "Provider failed",
    }),
    exitCode: 0,
  });
  const runner = new PiWorkerRunner(registry, taskStore, harness, Clock.createNull(TIMESTAMP));

  // act
  const exitCode = await runner.execute(input());

  // assert
  expect(exitCode).toBe(1);
  expect(registry.jobs.get("job_plan")).toMatchObject({ status: "failed", progress: "Provider failed" });
  expect(registry.tasks.get("task_demo")?.status).toBe("failed");
  expect((await taskStore.events("task_demo", "job_plan", "session_plan").readAll()).at(-1))
    .toEqual({ timestamp: TIMESTAMP, type: "session.completed", exitCode: 0 });
});

function createRegistry(job: Job = planningJob()): Registry {
  return Registry.createNull({
    projects: [{
      id: "project_demo",
      name: "Greeting demo",
      rootDir: "/projects/greeting",
      createdAt: TIMESTAMP,
      lastUsedAt: TIMESTAMP,
    }],
    tasks: [{
      id: "task_demo",
      projectId: "project_demo",
      title: "Implement greeting CLI",
      status: "queued",
      createdAt: TIMESTAMP,
      finishedAt: null,
    }],
    jobs: [job],
    workerSessions: [{
      id: "session_plan",
      jobId: "job_plan",
      harnessSessionId: null,
      harnessSessionPath: null,
      storagePath: "/worker/session-plan",
      createdAt: TIMESTAMP,
    }],
  });
}

function createTaskStore(): TaskStore {
  return TaskStore.createNull({
    requests: [{ taskId: "task_demo", jobId: "job_plan", text: REQUEST }],
    eventLogs: [{ taskId: "task_demo", jobId: "job_plan", workerSessionId: "session_plan" }],
  });
}

function planningJob(): Job {
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
    status: "queued",
    progress: null,
    createdAt: TIMESTAMP,
    finishedAt: null,
    bundlePath: "/worker/job-plan",
    userNotified: false,
    agentNotified: false,
  };
}

function input() {
  return { taskId: "task_demo", jobId: "job_plan", workerSessionId: "session_plan" };
}

function piOutput(final: { content: string; stopReason: string; errorMessage?: string }): string[] {
  return [
    { type: "session", version: 3, id: "pi-native-session", timestamp: TIMESTAMP, cwd: "/projects/greeting" },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: final.content } },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: final.content }],
        stopReason: final.stopReason,
        errorMessage: final.errorMessage,
      },
    },
    { type: "agent_settled" },
  ].map((line) => JSON.stringify(line));
}
