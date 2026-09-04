import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";

export type ManagerNotificationLevel = "info" | "warning" | "error";

export interface ManagerSession {
  cwd: string;
  hasUI: boolean;
  sessionId: string;
  sessionFile: string | null;
  notify(message: string, level: ManagerNotificationLevel): void;
  confirm(title: string, message: string): Promise<boolean>;
}

export interface ManagerToolResult<TDetails = unknown> {
  content: Array<{ type: "text"; text: string }>;
  details?: TDetails;
}

export interface ManagerTool<TParams extends TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  execute(params: Static<TParams>, session: ManagerSession): Promise<ManagerToolResult<TDetails>>;
}

export interface ManagerToolCallDecision {
  block: true;
  reason: string;
  terminate?: boolean;
}

export interface ManagerCommand {
  description: string;
  handler(args: string, session: ManagerSession): Promise<void> | void;
}

type PiExtensionDriver = Pick<
  ExtensionAPI,
  "getActiveTools" | "on" | "registerCommand" | "registerTool" | "sendMessage" | "setActiveTools"
>;

/** INFRASTRUCTURE_WRAPPER: exposes the Pi extension capabilities needed by the manager application. */
export class PiExtension {
  constructor(private readonly driver: PiExtensionDriver) {}

  static create(driver: ExtensionAPI): PiExtension {
    return new PiExtension(driver);
  }

  static createNull(activeTools: string[] = []): PiExtension {
    let currentTools = [...activeTools];
    return new PiExtension({
      getActiveTools: () => [...currentTools],
      on: () => {},
      registerCommand: () => {},
      registerTool: () => {},
      sendMessage: () => {},
      setActiveTools: (toolNames: string[]) => { currentTools = [...toolNames]; },
    } as unknown as PiExtensionDriver);
  }

  onSessionStart(handler: (session: ManagerSession) => Promise<void> | void): void {
    this.driver.on("session_start", async (_event, context) => handler(toManagerSession(context)));
  }

  onSessionShutdown(handler: () => Promise<void> | void): void {
    this.driver.on("session_shutdown", handler);
  }

  onToolCall(handler: (toolName: string) => ManagerToolCallDecision | undefined): void {
    this.driver.on("tool_call", (event) => handler(event.toolName));
  }

  registerTool<TParams extends TSchema, TDetails = unknown>(tool: ManagerTool<TParams, TDetails>): void {
    const register = this.driver.registerTool as (definition: unknown) => void;
    register({
      ...tool,
      execute: async (
        _toolCallId: string,
        params: unknown,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        context: ExtensionContext,
      ) => tool.execute(params as Static<TParams>, toManagerSession(context)),
    });
  }

  registerCommand(name: string, command: ManagerCommand): void {
    this.driver.registerCommand(name, {
      description: command.description,
      handler: async (args, context) => { await command.handler(args, toManagerSession(context)); },
    });
  }

  activeTools(): string[] { return this.driver.getActiveTools(); }
  activateTools(toolNames: string[]): void { this.driver.setActiveTools(toolNames); }

  sendManagerMessage(message: string): void {
    this.driver.sendMessage({
      customType: "worker-agent-result",
      content: message,
      display: false,
    }, { triggerTurn: true });
  }
}

function toManagerSession(context: ExtensionContext): ManagerSession {
  return {
    cwd: context.cwd,
    hasUI: context.hasUI,
    sessionId: context.sessionManager.getSessionId(),
    sessionFile: context.sessionManager.getSessionFile() ?? null,
    notify: (message, level) => context.ui.notify(message, level),
    confirm: (title, message) => context.ui.confirm(title, message),
  };
}
