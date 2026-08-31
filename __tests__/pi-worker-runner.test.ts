import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GreetingProjectFixture } from "../src/demo/greeting-project-fixture.ts";
import type { PiInvocation, PiProcess } from "../src/runner/pi-worker-runner.ts";
import { PiWorkerRunner } from "../src/runner/pi-worker-runner.ts";
import { Registry } from "../src/storage/registry.ts";
import { TaskStore } from "../src/storage/task-store.ts";
import { WorkerDemoPlanningJobCreator } from "../src/workflows/worker-demo-planning-job-creator.ts";
import { WorkerDemoTaskCreator } from "../src/workflows/worker-demo-task-creator.ts";
import { removeTestDirectory } from "./test-directory.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

class FixedIds {
  createProjectId(): string { return "project_demo"; }
  createTaskId(): string { return "task_demo"; }
  createJobId(): string { return "job_plan"; }
  createWorkerSessionId(): string { return "session_plan"; }
}

const now = () => "2026-08-30T12:00:00Z";

test("executes a planning job through Pi JSON output without calling a model", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-runner-"));
  roots.push(root);
  const { registry, taskStore, demo, planning } = await createPlanningJob(root);

  let invocation: PiInvocation | undefined;
  const spawnPi = (input: PiInvocation): PiProcess => {
    invocation = input;
    return {
      pid: 1234,
      stdout: stream([
        { type: "session", version: 3, id: "pi-native-session", timestamp: now(), cwd: input.cwd },
        { type: "message_start", message: { role: "assistant", content: [] } },
        { type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Change src/index.ts." } },
        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Change src/index.ts." }] } },
        { type: "agent_settled" },
      ].map((line) => JSON.stringify(line)).join("\n") + "\n"),
      stderr: stream(""),
      exited: Promise.resolve(0),
      kill() {},
    };
  };

  const exitCode = await new PiWorkerRunner(registry, taskStore, spawnPi, now).execute({
    taskId: demo.task.id,
    jobId: planning.job.id,
    workerSessionId: planning.workerSession.id,
  });

  expect(exitCode).toBe(0);
  expect(invocation).toMatchObject({
    cwd: demo.fixture.rootDir,
    model: "anthropic/claude-test",
    effortLevel: "high",
  });
  expect(invocation?.prompt).toBe(readFileSync(taskStore.paths.request("task_demo", "job_plan"), "utf8"));
  expect(registry.jobs.get("job_plan")).toMatchObject({ status: "completed", progress: "Planning completed" });
  expect(registry.tasks.get("task_demo")?.status).toBe("running");
  expect(registry.workerSessions.get("session_plan")).toMatchObject({
    harnessSessionId: "pi-native-session",
    harnessSessionPath: null,
  });
  expect((await taskStore.events("task_demo", "job_plan", "session_plan").readAll()).map((event) => event.type))
    .toEqual([
      "session.started",
      "prompt",
      "assistant.started",
      "assistant.text",
      "assistant.completed",
      "session.completed",
    ]);

  registry.close();
});

test("fails the job when Pi reports an assistant error despite exiting zero", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-runner-"));
  roots.push(root);
  const { registry, taskStore, demo, planning } = await createPlanningJob(root);
  const spawnPi = (input: PiInvocation): PiProcess => ({
    pid: 1234,
    stdout: stream([
      { type: "session", version: 3, id: "pi-native-session", timestamp: now(), cwd: input.cwd },
      { type: "message_start", message: { role: "assistant", content: [] } },
      {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Provider failed" },
      },
      { type: "agent_settled" },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n"),
    stderr: stream(""),
    exited: Promise.resolve(0),
    kill() {},
  });

  const exitCode = await new PiWorkerRunner(registry, taskStore, spawnPi, now).execute({
    taskId: demo.task.id,
    jobId: planning.job.id,
    workerSessionId: planning.workerSession.id,
  });

  expect(exitCode).toBe(1);
  expect(registry.jobs.get("job_plan")).toMatchObject({ status: "failed", progress: "Provider failed" });
  expect(registry.tasks.get("task_demo")?.status).toBe("failed");
  expect((await taskStore.events("task_demo", "job_plan", "session_plan").readAll()).at(-1))
    .toEqual({ timestamp: now(), type: "session.completed", exitCode: 0 });

  registry.close();
});

async function createPlanningJob(root: string) {
  const dataRoot = join(root, "data");
  const registry = new Registry(dataRoot);
  const taskStore = new TaskStore(dataRoot);
  const ids = new FixedIds();
  const demo = await new WorkerDemoTaskCreator(
    new GreetingProjectFixture(join(root, ".examples")),
    taskStore,
    registry,
    ids,
    now,
  ).create();
  const planning = await new WorkerDemoPlanningJobCreator(taskStore, registry, ids, now).create(demo, {
    parentSessionId: "manager-session",
    parentSessionFile: "/tmp/manager.jsonl",
    model: "anthropic/claude-test",
    modelName: "Claude Test",
    modelVersion: "claude-test",
    effortLevel: "high",
  });
  return { registry, taskStore, demo, planning };
}

function stream(content: string): ReadableStream<Uint8Array> {
  return new Response(content).body!;
}
