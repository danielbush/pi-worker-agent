import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PiExtension } from "../pi-extension.ts";

test("translates Pi driver context and tool results through application-owned contracts", async () => {
  // arrange
  let registeredTool: any;
  const messages: unknown[] = [];
  const driver = {
    getActiveTools: () => ["read"],
    on: () => {},
    registerCommand: () => {},
    registerTool: (tool: unknown) => { registeredTool = tool; },
    sendMessage: (...args: unknown[]) => { messages.push(args); },
    setActiveTools: () => {},
  } as unknown as ExtensionAPI;
  const pi = PiExtension.create(driver);
  let observed: unknown;
  pi.registerTool({
    name: "demo",
    label: "Demo",
    description: "Demo tool",
    parameters: Type.Object({ value: Type.String() }),
    execute: async (params, session) => {
      observed = { params, cwd: session.cwd, sessionId: session.sessionId };
      return { content: [{ type: "text", text: params.value }] };
    },
  });
  const context = {
    cwd: "/workspace",
    hasUI: true,
    sessionManager: { getSessionId: () => "session", getSessionFile: () => "/session.jsonl" },
    ui: { notify: () => {}, confirm: async () => true },
  };

  // act
  const result = await registeredTool.execute("call", { value: "hello" }, undefined, undefined, context);
  pi.sendManagerMessage("finished");

  // assert
  expect(observed).toEqual({ params: { value: "hello" }, cwd: "/workspace", sessionId: "session" });
  expect(result).toEqual({ content: [{ type: "text", text: "hello" }] });
  expect(messages).toHaveLength(1);
});
