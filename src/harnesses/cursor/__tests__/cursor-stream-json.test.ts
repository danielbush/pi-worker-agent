import { expect, test } from "bun:test";
import { CursorStreamJsonNormalizer } from "../cursor-stream-json.ts";

const TIMESTAMP = "2026-09-01T00:00:00Z";

test("normalizes the unverified candidate Cursor variants without duplicating final output", async () => {
  // arrange
  const fixture = await Bun.file(new URL("../__fixtures__/unverified-candidate.jsonl", import.meta.url)).text();
  const normalizer = new CursorStreamJsonNormalizer();

  // act
  const output = fixture.trim().split("\n").map((line) => normalizer.consume(line, TIMESTAMP));
  const events = output.flatMap((item) => item.events);

  // assert
  expect(output[0]?.harnessSessionId).toBe("cursor-chat-123");
  expect(events.filter((event) => event.type === "assistant.text")).toHaveLength(1);
  expect(events.filter((event) => event.type === "assistant.completed")).toEqual([{ timestamp: TIMESTAMP, type: "assistant.completed", text: "Implemented it." }]);
  expect(events.find((event) => event.type === "tool.started")).toMatchObject({ toolCallId: "native-tool-7", toolName: "Write" });
  expect(output.at(-1)).toMatchObject({ terminal: true, success: true });
});

test("requires an explicit successful result event", () => {
  const normalizer = new CursorStreamJsonNormalizer();
  const assistant = normalizer.consume(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "partial" }] } }), TIMESTAMP);
  expect(assistant.terminal).toBeUndefined();
  expect(() => normalizer.consume('{"type":"unknown"}', TIMESTAMP)).toThrow("Unsupported Cursor");
});
