import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { WorkerEvent } from "../../domain/events.ts";

type JsonObject = Record<string, unknown>;

export interface PiSessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

export type PiJsonLine = PiSessionHeader | JsonAgentSessionEvent;

export interface NormalizedPiLine {
  events: WorkerEvent[];
  harnessSessionId?: string;
}

/** Parses one JSONL record emitted by Pi's JSON output mode. */
export function parsePiJsonLine(line: string): PiJsonLine {
  return JSON.parse(line) as PiJsonLine;
}

/** Converts one typed Pi JSON record into canonical worker-session data. */
export function normalizePiJsonLine(raw: PiJsonLine, receivedAt: string): NormalizedPiLine {
  const timestamp = raw.type === "session" ? raw.timestamp : receivedAt;

  switch (raw.type) {
    case "session":
      return {
        harnessSessionId: raw.id,
        events: [{ timestamp, type: "session.started" }],
      };
    case "message_start":
      return { events: normalizeMessageStart(raw.message, timestamp) };
    case "message_update":
      return { events: normalizeMessageUpdate(raw.assistantMessageEvent, timestamp) };
    case "message_end":
      return { events: normalizeMessageEnd(raw.message, timestamp) };
    case "tool_execution_start":
      return {
        events: [{
          timestamp,
          type: "tool.started",
          toolCallId: raw.toolCallId,
          toolName: raw.toolName,
          arguments: raw.args,
        }],
      };
    case "tool_execution_update":
      return {
        events: [{
          timestamp,
          type: "tool.output",
          toolCallId: raw.toolCallId,
          toolName: raw.toolName,
          result: raw.partialResult,
        }],
      };
    case "tool_execution_end":
      return {
        events: [{
          timestamp,
          type: "tool.completed",
          toolCallId: raw.toolCallId,
          toolName: raw.toolName,
          result: raw.result,
          isError: raw.isError,
        }],
      };
    case "agent_settled":
      return { events: [{ timestamp, type: "session.completed" }] };
    default:
      return { events: [] };
  }
}

function normalizeMessageStart(raw: unknown, timestamp: string): WorkerEvent[] {
  const message = object(raw);
  if (message.role === "assistant") return [{ timestamp, type: "assistant.started" }];
  if (message.role === "user") return [{ timestamp, type: "prompt", text: messageText(message) }];
  return [];
}

function normalizeMessageUpdate(raw: unknown, timestamp: string): WorkerEvent[] {
  const event = object(raw);
  if (event.type === "text_delta") {
    return [{ timestamp, type: "assistant.text", text: string(event.delta) }];
  }
  if (event.type === "thinking_delta") {
    return [{ timestamp, type: "assistant.thinking", text: string(event.delta) }];
  }
  return [];
}

function normalizeMessageEnd(raw: unknown, timestamp: string): WorkerEvent[] {
  const message = object(raw);
  if (message.role !== "assistant") return [];
  return [{ timestamp, type: "assistant.completed", text: messageText(message) }];
}

function messageText(message: JsonObject): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map(object)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" ? value as JsonObject : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
