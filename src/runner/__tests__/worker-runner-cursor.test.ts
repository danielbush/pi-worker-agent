import { expect, test } from "bun:test";
import { profileFingerprint } from "../../domain/execution-profile.ts";
import { CURSOR_SDK_WORKER_ENTRY_POINT } from "../../harnesses/cursor/cursor-harness-contract.ts";
import { Clock } from "../../infrastructure/system/clock.ts";
import { NativeHarness } from "../../infrastructure/process/native-harness.ts";
import { Registry } from "../../storage/registry.ts";
import { TaskStore } from "../../storage/task-store.ts";
import { WorkerRunner } from "../worker-runner.ts";

const TIME = "2026-09-01T00:00:00Z";
const invocation = { executable: "/null/bin/bun", args: [CURSOR_SDK_WORKER_ENTRY_POINT, "run", "--tools", "read,grep,find,ls,write,edit,bash", "--model", "grok-4.5", "--params", '{"effort":"high","fast":"false"}'] };

test("runs Cursor in the implementation worktree and requires its terminal success event", async () => {
  // arrange
  const registry = Registry.createNull({
    workspaces: [{ id: "workspace", name: "demo", rootDir: "/workspace", createdAt: TIME, lastUsedAt: TIME }],
    tasks: [{ id: "task", workspaceId: "workspace", title: "Implement", status: "queued", createdAt: TIME, finishedAt: null }],
    jobs: [{
      id: "job", taskId: "task", jobType: "implement", parentSessionId: "manager", parentSessionFile: null,
      snapshotProvenance: "current", workerProfile: "cursor-grok-high", profileFingerprint: profileFingerprint({ name: "cursor-grok-high", harness: "cursor-agent", model: "grok-4.5", options: { effort: "high", fast: "false" } }), profileOptions: '{"effort":"high","fast":"false"}', capabilityProfile: "code",
      harness: "cursor-agent", harnessVersion: "1.0.0-test", nativeInvocation: JSON.stringify(invocation),
      model: "grok-4.5", effortLevel: "high", modelName: "grok-4.5", modelVersion: "grok-4.5",
      title: "Implement", status: "queued", progress: null, createdAt: TIME, finishedAt: null, bundlePath: "/job", userNotified: false, agentNotified: false,
    }],
    workerSessions: [{ id: "session", jobId: "job", harnessSessionId: null, harnessSessionPath: null, storagePath: "/session", createdAt: TIME }],
  });
  const store = TaskStore.createNull({ requests: [{ taskId: "task", jobId: "job", text: "Implement it." }], eventLogs: [{ taskId: "task", jobId: "job", workerSessionId: "session" }] });
  const lines = [
    { type: "cursor_sdk_session", agentId: "cursor-agent-123", runId: "run-123" },
    { type: "cursor_sdk_message", message: { type: "system", subtype: "init", agent_id: "cursor-agent-123", run_id: "run-123" } },
    { type: "cursor_sdk_message", message: { type: "assistant", agent_id: "cursor-agent-123", run_id: "run-123", message: { role: "assistant", content: [{ type: "text", text: "Implemented." }] } } },
    { type: "cursor_sdk_result", agentId: "cursor-agent-123", runId: "run-123", status: "finished", result: "Implemented." },
  ].map((line) => JSON.stringify(line));
  const harness = NativeHarness.createNull({ stdoutLines: lines });
  const runner = new WorkerRunner(registry, store, harness, Clock.createNull(TIME));

  // act
  const exitCode = await runner.execute({ taskId: "task", jobId: "job", workerSessionId: "session" });

  // assert
  expect(exitCode).toBe(0);
  expect(registry.jobs.get("job")?.status).toBe("completed");
  expect(registry.workerSessions.get("session")?.harnessSessionId).toBe("cursor-agent-123");
  expect(harness.state.invocations[0]).toMatchObject({ cwd: "/null-worker-agent/worktrees/job", harness: "cursor-agent", nativeInvocation: invocation, writablePaths: ["/session/harness-session", "/tmp/pi-worker-agent-null-private", "/null-worker-agent/worktrees/job"] });
  expect((await store.events("task", "job", "session").readAll()).filter((event) => event.type === "assistant.completed")).toHaveLength(1);
});
