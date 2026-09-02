import type { WorkerEvent } from "../../domain/events.ts";

export const CURSOR_VERIFIED_VERSION = "2026.08.25-3e8eec8";
export const CURSOR_STREAM_CONTRACT = `cursor-agent/${CURSOR_VERIFIED_VERSION}-stream-json`;

export interface CursorNormalization {
  events: WorkerEvent[];
  harnessSessionId?: string;
  terminal?: boolean;
  success?: boolean;
  failure?: string;
}

/** Normalizes the captured Cursor `--print --output-format stream-json` envelope for CURSOR_VERIFIED_VERSION. */
export class CursorStreamJsonNormalizer {
  private assistantStarted = false;
  private text = "";

  consume(line: string, timestamp: string): CursorNormalization {
    let value: Record<string, unknown>;
    try { value = JSON.parse(line) as Record<string, unknown>; }
    catch { throw new Error(`Invalid Cursor stream-json line: ${line}`); }
    const type = string(value.type);
    const session = string(value.session_id) ?? string(value.sessionId) ?? string(value.chatId);
    if (type === "system" || type === "session" || type === "user" || type === "thinking") {
      return { events: [], harnessSessionId: session };
    }

    if (type === "assistant") {
      const events: WorkerEvent[] = [];
      const message = object(value.message);
      const content = message?.content ?? value.content;
      for (const block of Array.isArray(content) ? content : [content]) {
        const item = object(block);
        if (item?.type === "text" && typeof item.text === "string") this.appendAssistantText(item.text, timestamp, events);
      }
      return { events, harnessSessionId: session };
    }

    if (type === "tool_call") {
      const call = object(value.tool_call) ?? {};
      const variant = toolCallVariant(call);
      const id = string(call.toolCallId) ?? string(value.call_id) ?? "cursor-tool";
      if (string(value.subtype) === "started") {
        return { events: [{ timestamp, type: "tool.started", toolCallId: id, toolName: variant?.name ?? "unknown", arguments: variant?.inner.args ?? variant?.inner.arguments }], harnessSessionId: session };
      }
      const result = variant?.inner.result;
      return { events: [{ timestamp, type: "tool.completed", toolCallId: id, result, isError: isToolError(result) }], harnessSessionId: session };
    }

    if (type === "result") {
      const failed = Boolean(value.is_error) || value.subtype === "error" || value.subtype === "failure";
      const result = string(value.result) ?? string(value.error);
      const events: WorkerEvent[] = [];
      if (!this.assistantStarted) events.push({ timestamp, type: "assistant.started" });
      const finalText = this.text || result;
      if (!this.text && result) events.push({ timestamp, type: "assistant.text", text: result });
      if (finalText) events.push({ timestamp, type: "assistant.completed", text: finalText });
      return { events, harnessSessionId: session, terminal: true, success: !failed && value.subtype === "success", failure: failed ? result ?? "Cursor reported failure" : undefined };
    }
    throw new Error(`Unsupported Cursor stream-json event type: ${type ?? "missing"}`);
  }

  private appendAssistantText(text: string, timestamp: string, events: WorkerEvent[]): void {
    if (!text || text === this.text) return;
    let delta = text;
    if (this.text && text.startsWith(this.text)) {
      delta = text.slice(this.text.length);
      this.text = text;
    } else {
      this.text += text;
    }
    if (!delta) return;
    if (!this.assistantStarted) { events.push({ timestamp, type: "assistant.started" }); this.assistantStarted = true; }
    events.push({ timestamp, type: "assistant.text", text: delta });
  }
}

function toolCallVariant(call: Record<string, any>): { name: string; inner: Record<string, any> } | undefined {
  for (const [key, value] of Object.entries(call)) {
    if (key.endsWith("ToolCall") && value && typeof value === "object" && !Array.isArray(value)) {
      return { name: key.slice(0, -"ToolCall".length) || key, inner: value };
    }
  }
}

function isToolError(result: unknown): boolean {
  const value = object(result);
  return Boolean(value?.error) && !value?.success;
}

function object(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
