import { expect, test } from "bun:test";
import { HarnessSessionFiles } from "../../infrastructure/filesystem/harness-session-files.ts";
import { JobFiles } from "../../infrastructure/filesystem/job-files.ts";
import { TaskFiles } from "../../infrastructure/filesystem/task-files.ts";
import { WorkerAgentPaths } from "../paths.ts";
import { TaskStore } from "../task-store.ts";
import { WorkerSessionEventLogs } from "../task-store/worker-session-event-logs.ts";

const TIMESTAMP = "2026-08-30T12:00:00Z";

test("composes nulled task, job, harness-session, and event storage", async () => {
  // arrange
  const paths = new WorkerAgentPaths("/null-worker-agent");
  const taskFiles = TaskFiles.createNull(paths);
  const jobFiles = JobFiles.createNull(paths);
  const harnessSessions = HarnessSessionFiles.createNull({
    "pi-native-session": "/null-worker-agent/harness-session/native.jsonl",
  });
  const eventLogs = WorkerSessionEventLogs.createNull();
  const store = new TaskStore(paths, taskFiles, jobFiles, harnessSessions, eventLogs);

  // act
  await store.tasks.create({
    taskId: "task_test",
    intent: "Keep the greeting friendly.",
    background: "A small Bun project.",
  });
  await store.jobs.create({
    taskId: "task_test",
    jobId: "job_plan",
    request: "Plan the greeting CLI.",
  });
  const events = store.events("task_test", "job_plan", "session_test");
  await events.create();
  await events.append({ timestamp: TIMESTAMP, type: "assistant.text", text: "Planning" });
  const sessionDirectory = await store.prepareHarnessSessionDirectory("/null-worker-agent/session_test");

  // assert
  expect(taskFiles.state).toEqual([{
    taskId: "task_test",
    intent: "Keep the greeting friendly.",
    background: "A small Bun project.",
  }]);
  expect(jobFiles.state).toEqual([{
    taskId: "task_test",
    jobId: "job_plan",
    request: "Plan the greeting CLI.",
  }]);
  expect(await events.readAll()).toEqual([
    { timestamp: TIMESTAMP, type: "assistant.text", text: "Planning" },
  ]);
  expect(sessionDirectory).toBe("/null-worker-agent/session_test/harness-session");
  expect(await store.findHarnessSessionPath(sessionDirectory, "pi-native-session"))
    .toBe("/null-worker-agent/harness-session/native.jsonl");
});
