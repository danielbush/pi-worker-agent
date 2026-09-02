import { expect, test } from "bun:test";
import type { Job } from "../../domain/job.ts";
import { Clock } from "../../infrastructure/system/clock.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskCompleter } from "../task-completer.ts";

const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";
const STARTED = "2026-09-03T12:00:00Z";
const FINISHED = "2026-09-03T13:00:00Z";

test("completes a manager-accepted task after its final job completes", () => {
  // arrange
  const registry = registryWithJobs([
    job("job_failed_plan", "failed", STARTED),
    job("job_implementation", "completed", "2026-09-03T12:10:00Z"),
    job("job_review", "completed", "2026-09-03T12:20:00Z"),
  ]);
  const completer = new TaskCompleter(registry, Clock.createNull(FINISHED));

  // act
  const task = completer.complete("ab12");

  // assert
  expect(task).toMatchObject({ id: TASK_ID, status: "completed", finishedAt: FINISHED });
});

test("refuses to complete a task with active work", () => {
  // arrange
  const completer = new TaskCompleter(
    registryWithJobs([job("job_review", "running", STARTED)]),
    Clock.createNull(FINISHED),
  );

  // act / assert
  expect(() => completer.complete(TASK_ID)).toThrow("Task has unsettled jobs: job_review");
});

test("refuses to complete a task whose final job failed", () => {
  // arrange
  const completer = new TaskCompleter(
    registryWithJobs([job("job_review", "failed", STARTED)]),
    Clock.createNull(FINISHED),
  );

  // act / assert
  expect(() => completer.complete(TASK_ID)).toThrow("Final job is not completed: job_review (failed)");
});

function registryWithJobs(jobs: Job[]): Registry {
  return Registry.createNull({
    tasks: [{
      id: TASK_ID,
      workspaceId: null,
      title: "Review task",
      status: "running",
      createdAt: STARTED,
      finishedAt: null,
    }],
    jobs,
  });
}

function job(id: string, status: Job["status"], createdAt: string): Job {
  return {
    id,
    taskId: TASK_ID,
    jobType: id.includes("review") ? "review" : id.includes("implementation") ? "implement" : "plan",
    parentSessionId: "manager-session",
    parentSessionFile: null,
    harness: "pi",
    model: "anthropic/test",
    effortLevel: "high",
    modelName: "Test",
    modelVersion: "test",
    title: id,
    status,
    progress: null,
    createdAt,
    finishedAt: status === "running" ? null : createdAt,
    bundlePath: `/jobs/${id}`,
    userNotified: true,
    agentNotified: true,
  };
}
