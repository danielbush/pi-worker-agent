import type { SDKMessage } from "@cursor/sdk";
import type { WorkerEvent } from "../../domain/events.ts";

interface CursorSdkPhaseEnvelope {
  type: "cursor_sdk_phase";
  phase: string;
  status: "started" | "completed" | "failed" | "ready" | "closed";
  elapsedMs?: number;
  detail?: string;
}
interface CursorSdkSessionEnvelope { type: "cursor_sdk_session"; agentId: string; runId: string; }
interface CursorSdkMessageEnvelope { type: "cursor_sdk_message"; message: SDKMessage; }
interface CursorSdkResultEnvelope {
  type: "cursor_sdk_result";
  agentId: string;
  runId: string;
  status: "finished" | "error" | "cancelled";
  result?: string;
  error?: { message?: string; code?: string };
}
type CursorSdkEnvelope = CursorSdkPhaseEnvelope | CursorSdkSessionEnvelope | CursorSdkMessageEnvelope | CursorSdkResultEnvelope;

export interface CursorSdkNormalization {
  events: WorkerEvent[];
  harnessSessionId?: string;
  terminal?: boolean;
  success?: boolean;
  failure?: string;
}

/** Normalizes typed Cursor SDK messages emitted by the sandboxed SDK worker. */
export class CursorSdkEventNormalizer {
  private assistantStarted = false;
  private text = "";

  consume(line: string, timestamp: string): CursorSdkNormalization {
    let envelope: CursorSdkEnvelope;
    try { envelope = JSON.parse(line) as CursorSdkEnvelope; }
    catch { throw new Error(`Invalid Cursor SDK worker line: ${line}`); }

    if (envelope.type === "cursor_sdk_phase") {
      return {
        events: [{
          timestamp,
          type: "harness.phase",
          text: `${envelope.phase}.${envelope.status}`,
          result: {
            ...(envelope.elapsedMs === undefined ? {} : { elapsedMs: envelope.elapsedMs }),
            ...(envelope.detail === undefined ? {} : { detail: envelope.detail }),
          },
        }],
      };
    }
    if (envelope.type === "cursor_sdk_session") {
      return { events: [], harnessSessionId: envelope.agentId };
    }
    if (envelope.type === "cursor_sdk_result") {
      const events: WorkerEvent[] = [];
      const finalText = this.text || envelope.result || "";
      if (!this.assistantStarted) events.push({ timestamp, type: "assistant.started" });
      if (!this.text && envelope.result) events.push({ timestamp, type: "assistant.text", text: envelope.result });
      events.push({ timestamp, type: "assistant.completed", text: finalText });
      const success = envelope.status === "finished";
      const failure = success ? undefined : envelope.error?.message ?? `Cursor SDK run ${envelope.status}`;
      if (failure) events.push({ timestamp, type: "error", error: failure });
      return { events, harnessSessionId: envelope.agentId, terminal: true, success, failure };
    }
    if (envelope.type !== "cursor_sdk_message" || !envelope.message) {
      throw new Error("Unsupported Cursor SDK worker envelope");
    }

    const message = envelope.message;
    const harnessSessionId = message.agent_id;
    switch (message.type) {
      case "assistant": {
        const events: WorkerEvent[] = [];
        for (const block of message.message.content) {
          if (block.type === "text") this.appendText(block.text, timestamp, events);
        }
        return { events, harnessSessionId };
      }
      case "thinking":
        return { events: message.text ? [{ timestamp, type: "assistant.thinking", text: message.text }] : [], harnessSessionId };
      case "tool_call":
        if (message.status === "running") {
          return { events: [{ timestamp, type: "tool.started", toolCallId: message.call_id, toolName: message.name, arguments: message.args }], harnessSessionId };
        }
        return { events: [{ timestamp, type: "tool.completed", toolCallId: message.call_id, toolName: message.name, result: message.result, isError: message.status === "error" }], harnessSessionId };
      case "status":
      case "system":
      case "user":
      case "request":
      case "task":
      case "usage":
        return { events: [], harnessSessionId };
    }
  }

  private appendText(text: string, timestamp: string, events: WorkerEvent[]): void {
    if (!text) return;
    if (!this.assistantStarted) {
      events.push({ timestamp, type: "assistant.started" });
      this.assistantStarted = true;
    }
    this.text += text;
    events.push({ timestamp, type: "assistant.text", text });
  }
}
