import { expect, test } from "bun:test";
import { profileFingerprint } from "../../domain/execution-profile.ts";
import { Clock } from "../../infrastructure/system/clock.ts";
import { NativeHarness } from "../../infrastructure/process/native-harness.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { WorkerRunner } from "../worker-runner.ts";

const TIME = "2026-09-01T00:00:00Z";
const invocation = { executable: "/null/bin/cursor-agent", args: ["--print", "--output-format", "stream-json", "--stream-partial-output", "--model", "cursor-grok-4.5-high", "--trust", "--sandbox", "disabled", "--workspace", "/null-worker-agent/worktrees/job", "--force"] };

test("runs Cursor in the implementation worktree and requires its terminal success event", async () => {
  // arrange
  const registry = Registry.createNull({
    workspaces: [{ id: "workspace", name: "demo", rootDir: "/workspace", createdAt: TIME, lastUsedAt: TIME }],
    tasks: [{ id: "task", workspaceId: "workspace", title: "Implement", status: "queued", createdAt: TIME, finishedAt: null }],
    jobs: [{
      id: "job", taskId: "task", jobType: "implement", parentSessionId: "manager", parentSessionFile: null,
      snapshotProvenance: "current", workerProfile: "cursor-grok-high", profileFingerprint: profileFingerprint({ name: "cursor-grok-high", harness: "cursor-agent", model: "cursor-grok-4.5-high", options: {} }), capabilityProfile: "code",
      harness: "cursor-agent", harnessVersion: "1.0.0-test", nativeInvocation: JSON.stringify(invocation),
      model: "cursor-grok-4.5-high", effortLevel: "", modelName: "cursor-grok-4.5-high", modelVersion: "cursor-grok-4.5-high",
      title: "Implement", status: "queued", progress: null, createdAt: TIME, finishedAt: null, bundlePath: "/job", userNotified: false, agentNotified: false,
    }],
    workerSessions: [{ id: "session", jobId: "job", harnessSessionId: null, harnessSessionPath: null, storagePath: "/session", createdAt: TIME }],
  });
  const store = TaskStore.createNull({ requests: [{ taskId: "task", jobId: "job", text: "Implement it." }], eventLogs: [{ taskId: "task", jobId: "job", workerSessionId: "session" }] });
  const lines = (await Bun.file(new URL("../../harnesses/cursor/__fixtures__/unverified-candidate.jsonl", import.meta.url)).text()).trim().split("\n");
  const harness = NativeHarness.createNull({ stdoutLines: lines });
  const runner = new WorkerRunner(registry, store, harness, Clock.createNull(TIME));

  // act
  const exitCode = await runner.execute({ taskId: "task", jobId: "job", workerSessionId: "session" });

  // assert
  expect(exitCode).toBe(0);
  expect(registry.jobs.get("job")?.status).toBe("completed");
  expect(registry.workerSessions.get("session")?.harnessSessionId).toBe("cursor-chat-123");
  expect(harness.state.invocations[0]).toMatchObject({ cwd: "/null-worker-agent/worktrees/job", harness: "cursor-agent", nativeInvocation: invocation, writablePaths: ["/session/harness-session", "/tmp/pi-worker-agent-null-private", "/null-worker-agent/worktrees/job"] });
  expect((await store.events("task", "job", "session").readAll()).filter((event) => event.type === "assistant.completed")).toHaveLength(1);
});
