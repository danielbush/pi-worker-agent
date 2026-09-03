import { expect, test } from "bun:test";
import { CursorSdkEventNormalizer } from "../cursor-sdk-event.ts";

const TIMESTAMP = "2026-09-01T00:00:00Z";

function envelope(value: unknown): string { return JSON.stringify(value); }

test("normalizes typed Cursor SDK messages and terminal success", () => {
  // arrange
  const normalizer = new CursorSdkEventNormalizer();
  const lines = [
    { type: "cursor_sdk_phase", phase: "agent.create", status: "started" },
    { type: "cursor_sdk_phase", phase: "agent.create", status: "completed", elapsedMs: 12 },
    { type: "cursor_sdk_session", agentId: "cursor-agent-123", runId: "run-123" },
    { type: "cursor_sdk_message", message: { type: "thinking", agent_id: "cursor-agent-123", run_id: "run-123", text: "Working" } },
    { type: "cursor_sdk_message", message: { type: "tool_call", agent_id: "cursor-agent-123", run_id: "run-123", call_id: "tool-7", name: "edit", status: "running", args: { path: "ping.txt" } } },
    { type: "cursor_sdk_message", message: { type: "tool_call", agent_id: "cursor-agent-123", run_id: "run-123", call_id: "tool-7", name: "edit", status: "completed", result: "done" } },
    { type: "cursor_sdk_message", message: { type: "assistant", agent_id: "cursor-agent-123", run_id: "run-123", message: { role: "assistant", content: [{ type: "text", text: "Created ping.txt." }] } } },
    { type: "cursor_sdk_result", agentId: "cursor-agent-123", runId: "run-123", status: "finished", result: "Created ping.txt." },
  ];

  // act
  const output = lines.map((line) => normalizer.consume(envelope(line), TIMESTAMP));
  const events = output.flatMap((item) => item.events);

  // assert
  expect(events.filter((event) => event.type === "harness.phase")).toEqual([
    { timestamp: TIMESTAMP, type: "harness.phase", text: "agent.create.started", result: {} },
    { timestamp: TIMESTAMP, type: "harness.phase", text: "agent.create.completed", result: { elapsedMs: 12 } },
  ]);
  expect(output[2]?.harnessSessionId).toBe("cursor-agent-123");
  expect(events.find((event) => event.type === "assistant.thinking")).toMatchObject({ text: "Working" });
  expect(events.find((event) => event.type === "tool.started")).toMatchObject({ toolCallId: "tool-7", toolName: "edit" });
  expect(events.find((event) => event.type === "tool.completed")).toMatchObject({ toolCallId: "tool-7", isError: false });
  expect(events.filter((event) => event.type === "assistant.completed")).toEqual([
    { timestamp: TIMESTAMP, type: "assistant.completed", text: "Created ping.txt." },
  ]);
  expect(output.at(-1)).toMatchObject({ terminal: true, success: true });
});

test("requires an explicit successful SDK result", () => {
  // arrange
  const normalizer = new CursorSdkEventNormalizer();

  // act
  const assistant = normalizer.consume(envelope({ type: "cursor_sdk_message", message: { type: "assistant", agent_id: "agent", run_id: "run", message: { role: "assistant", content: [{ type: "text", text: "partial" }] } } }), TIMESTAMP);
  const failed = normalizer.consume(envelope({ type: "cursor_sdk_result", agentId: "agent", runId: "run", status: "error", error: { message: "network failed" } }), TIMESTAMP);

  // assert
  expect(assistant.terminal).toBeUndefined();
  expect(failed).toMatchObject({ terminal: true, success: false, failure: "network failed" });
  expect(() => normalizer.consume('{"type":"unknown"}', TIMESTAMP)).toThrow("Unsupported Cursor SDK");
});
