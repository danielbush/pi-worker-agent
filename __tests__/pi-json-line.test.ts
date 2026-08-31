import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  normalizePiJsonLine,
  parsePiJsonLine,
} from "../src/harnesses/pi/pi-json-line.ts";

const RECEIVED_AT = "2026-08-30T12:00:01Z";

test("normalizes recorded Pi JSON events", async () => {
  const fixture = await Bun.file(join(import.meta.dir, "fixtures", "pi-events.jsonl")).text();
  const normalized = fixture
    .split("\n")
    .filter(Boolean)
    .map((line) => normalizePiJsonLine(parsePiJsonLine(line), RECEIVED_AT));
  const events = normalized.flatMap((result) => result.events);

  expect(normalized.find((result) => result.harnessSessionId)?.harnessSessionId).toBe("pi-session-123");
  expect(events.map((event) => event.type)).toEqual([
    "session.started",
    "prompt",
    "assistant.started",
    "assistant.thinking",
    "assistant.text",
    "tool.started",
    "tool.output",
    "tool.completed",
    "assistant.text",
    "assistant.completed",
    "session.completed",
  ]);
  expect(events[0]).toEqual({ timestamp: "2026-08-30T12:00:00Z", type: "session.started" });
  expect(events.find((event) => event.type === "prompt")?.text).toBe("Plan the greeting CLI.");
  expect(events.find((event) => event.type === "assistant.thinking")?.text).toBe("I should inspect the files.");
  expect(events.find((event) => event.type === "tool.started")).toEqual({
    timestamp: RECEIVED_AT,
    type: "tool.started",
    toolCallId: "call_read_1",
    toolName: "read",
    arguments: { path: "src/index.ts" },
  });
  expect(events.find((event) => event.type === "tool.completed")).toMatchObject({
    toolCallId: "call_read_1",
    result: { content: "Not implemented" },
    isError: false,
  });
  expect(events.find((event) => event.type === "assistant.completed")?.text)
    .toBe("I’ll inspect the project. The implementation needs two greeting cases.");
});

test("ignores typed Pi events without a canonical equivalent", () => {
  expect(normalizePiJsonLine({ type: "turn_start" }, RECEIVED_AT)).toEqual({ events: [] });
  expect(normalizePiJsonLine({ type: "agent_end", messages: [], willRetry: false }, RECEIVED_AT))
    .toEqual({ events: [] });
});
