import { expect, test } from "bun:test";
import { CursorStreamJsonNormalizer } from "../cursor-stream-json.ts";

const TIMESTAMP = "2026-09-01T00:00:00Z";

test("normalizes the captured Cursor stream-json envelope without duplicating replayed assistant text", async () => {
  // arrange
  const fixture = await Bun.file(new URL("../__fixtures__/2026.08.25-3e8eec8-stream-json.jsonl", import.meta.url)).text();
  const normalizer = new CursorStreamJsonNormalizer();

  // act
  const output = fixture.trim().split("\n").map((line) => normalizer.consume(line, TIMESTAMP));
  const events = output.flatMap((item) => item.events);

  // assert
  expect(output[0]?.harnessSessionId).toBe("cursor-chat-123");
  expect(events.filter((event) => event.type === "assistant.text").map((event) => event.type === "assistant.text" ? event.text : "")).toEqual([
    "Created `ping",
    ".txt` with the",
    " content `pong",
    "`.",
  ]);
  expect(events.filter((event) => event.type === "assistant.completed")).toEqual([
    { timestamp: TIMESTAMP, type: "assistant.completed", text: "Created `ping.txt` with the content `pong`." },
  ]);
  expect(events.find((event) => event.type === "tool.started")).toMatchObject({ toolCallId: "native-tool-7", toolName: "edit" });
  expect(events.find((event) => event.type === "tool.completed")).toMatchObject({ toolCallId: "native-tool-7", isError: false });
  expect(output.at(-1)).toMatchObject({ terminal: true, success: true });
});

test("requires an explicit successful result event", () => {
  const normalizer = new CursorStreamJsonNormalizer();
  const assistant = normalizer.consume(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "partial" }] } }), TIMESTAMP);
  expect(assistant.terminal).toBeUndefined();
  expect(() => normalizer.consume('{"type":"unknown"}', TIMESTAMP)).toThrow("Unsupported Cursor");
});
