import type { WorkerEvent } from "../../domain/events.ts";

export const CURSOR_STREAM_CONTRACT = "cursor-agent/unverified-stream-json-candidate";

export interface CursorNormalization {
  events: WorkerEvent[];
  harnessSessionId?: string;
  terminal?: boolean;
  success?: boolean;
  failure?: string;
}

/** Stateful normalization for the unverified candidate stream-json shape; production setup cannot select this adapter. */
export class CursorStreamJsonNormalizer {
  private assistantStarted = false;
  private text = "";
  private toolSequence = 0;

  consume(line: string, timestamp: string): CursorNormalization {
    let value: Record<string, unknown>;
    try { value = JSON.parse(line) as Record<string, unknown>; }
    catch { throw new Error(`Invalid Cursor stream-json line: ${line}`); }
    const type = string(value.type);
    const session = string(value.session_id) ?? string(value.sessionId) ?? string(value.chatId);
    if (type === "system" || type === "session") return { events: [], harnessSessionId: session };

    if (type === "assistant") {
      const events: WorkerEvent[] = [];
      if (!this.assistantStarted) { events.push({ timestamp, type: "assistant.started" }); this.assistantStarted = true; }
      const message = object(value.message);
      const content = message?.content ?? value.content;
      for (const block of Array.isArray(content) ? content : [content]) {
        const item = object(block);
        if (!item) continue;
        if (item.type === "text" && typeof item.text === "string") {
          this.text += item.text;
          events.push({ timestamp, type: "assistant.text", text: item.text });
        } else if (item.type === "tool_use" || item.type === "tool_call") {
          events.push({ timestamp, type: "tool.started", toolCallId: string(item.id) ?? string(item.tool_call_id) ?? `cursor-tool-${++this.toolSequence}`, toolName: string(item.name) ?? "unknown", arguments: item.input ?? item.arguments });
        }
      }
      return { events, harnessSessionId: session };
    }

    if (type === "tool" || type === "tool_result") {
      const call = object(value.tool_call) ?? value;
      const id = string(call.tool_call_id) ?? string(call.id) ?? "cursor-tool";
      const subtype = string(value.subtype);
      const result = value.result ?? value.output ?? call.result;
      if (subtype === "started") return { events: [{ timestamp, type: "tool.started", toolCallId: id, toolName: string(call.name) ?? "unknown", arguments: call.arguments ?? call.input }], harnessSessionId: session };
      return { events: [{ timestamp, type: "tool.completed", toolCallId: id, result, isError: Boolean(value.is_error ?? value.isError) }], harnessSessionId: session };
    }

    if (type === "result") {
      const failed = Boolean(value.is_error) || value.subtype === "error" || value.subtype === "failure";
      const result = string(value.result) ?? string(value.error);
      const events: WorkerEvent[] = [];
      // Result often repeats the streamed assistant text. Record exactly one canonical final.
      if (!this.assistantStarted) events.push({ timestamp, type: "assistant.started" });
      const finalText = this.text || result;
      if (!this.text && result) events.push({ timestamp, type: "assistant.text", text: result });
      if (finalText) events.push({ timestamp, type: "assistant.completed", text: finalText });
      return { events, harnessSessionId: session, terminal: true, success: !failed && value.subtype === "success", failure: failed ? result ?? "Cursor reported failure" : undefined };
    }
    throw new Error(`Unsupported Cursor stream-json event type: ${type ?? "missing"}`);
  }
}

function object(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
