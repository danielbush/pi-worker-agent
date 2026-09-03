import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, Cursor, FileCredentialStore, JsonlLocalAgentStore, type ModelSelection, type SDKMessage, type ToolName } from "@cursor/sdk";

const TOOL_NAMES: Readonly<Record<string, ToolName>> = {
  read: "read",
  grep: "grep",
  find: "glob",
  ls: "ls",
  write: "edit",
  edit: "edit",
  bash: "shell",
};

export async function main(args: string[]): Promise<number> {
  try {
    if (args.length === 1 && args[0] === "--version") {
      console.log(await sdkVersion());
      return 0;
    }
    if (args.length === 1 && args[0] === "--help") {
      console.log("run --model --params --tools --session-dir -- <prompt>\nprobe-models\nprobe-model\nprobe-auth");
      return 0;
    }

    const apiKey = await cursorApiKey();
    if (args[0] === "probe-auth") {
      if (!apiKey) throw new Error("Cursor SDK is not authenticated; set CURSOR_API_KEY or run Cursor.auth.login()");
      const user = await Cursor.me({ apiKey });
      console.log(JSON.stringify({ status: "ready", apiKeyName: user.apiKeyName }));
      return 0;
    }
    if (args[0] === "probe-models") {
      if (!apiKey) throw new Error("Cursor SDK is not authenticated; set CURSOR_API_KEY or run Cursor.auth.login()");
      for (const model of await Cursor.models.list({ apiKey })) console.log(model.id);
      return 0;
    }
    if (args[0] === "probe-model") {
      if (!apiKey) throw new Error("Cursor SDK is not authenticated; set CURSOR_API_KEY or run Cursor.auth.login()");
      const selection = modelSelection(option(args, "--model"), option(args, "--params"));
      const model = (await Cursor.models.list({ apiKey })).find((candidate) => candidate.id === selection.id);
      if (!model) throw new Error(`Cursor SDK model is unavailable: ${selection.id}`);
      for (const parameter of selection.params ?? []) {
        const definition = model.parameters?.find((candidate) => candidate.id === parameter.id);
        if (!definition?.values.some((candidate) => candidate.value === parameter.value)) {
          throw new Error(`Cursor SDK model parameter is unavailable: ${parameter.id}=${parameter.value}`);
        }
      }
      console.log(selection.id);
      return 0;
    }
    if (args[0] !== "run") throw new Error("Cursor SDK worker requires run, probe-auth, probe-models, probe-model, --help, or --version");
    if (!apiKey) throw new Error("Cursor SDK is not authenticated; set CURSOR_API_KEY or run Cursor.auth.login()");

    const model = modelSelection(option(args, "--model"), option(args, "--params"));
    const tools = [...new Set(option(args, "--tools").split(",").map((name) => TOOL_NAMES[name]).filter((name): name is ToolName => Boolean(name)))];
    const sessionDirectory = option(args, "--session-dir");
    const separator = args.indexOf("--");
    const prompt = separator >= 0 ? args.slice(separator + 1).join(" ") : "";
    if (!prompt) throw new Error("Cursor SDK worker prompt is missing");

    emitPhase("worker", "ready");
    const agent = await observed("agent.create", () => Agent.create({
      apiKey,
      model,
      tools,
      mode: "agent",
      local: {
        cwd: process.cwd(),
        store: new JsonlLocalAgentStore(sessionDirectory),
        sandboxOptions: { enabled: false },
      },
    }));
    try {
      const run = await observed("agent.send", () => agent.send(prompt, { model, mode: "agent", local: { force: true } }));
      console.log(JSON.stringify({ type: "cursor_sdk_session", agentId: agent.agentId, runId: run.id }));
      await observed("run.stream", async () => {
        for await (const message of run.stream()) emitSdkMessage(message);
      });
      const result = await observed("run.wait", () => run.wait());
      console.log(JSON.stringify({
        type: "cursor_sdk_result",
        agentId: agent.agentId,
        runId: run.id,
        status: result.status,
        result: result.result,
        error: result.error,
      }));
      return result.status === "finished" ? 0 : 1;
    } finally {
      agent.close();
      emitPhase("agent", "closed");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    return 1;
  }
}

type PhaseStatus = "started" | "completed" | "failed" | "ready" | "closed";

async function observed<T>(phase: string, action: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  emitPhase(phase, "started");
  try {
    const result = await action();
    emitPhase(phase, "completed", performance.now() - startedAt);
    return result;
  } catch (error) {
    emitPhase(phase, "failed", performance.now() - startedAt, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function emitPhase(phase: string, status: PhaseStatus, elapsedMs?: number, detail?: string): void {
  console.log(JSON.stringify({ type: "cursor_sdk_phase", phase, status, elapsedMs: elapsedMs === undefined ? undefined : Math.round(elapsedMs), detail }));
}

function emitSdkMessage(message: SDKMessage): void {
  console.log(JSON.stringify({ type: "cursor_sdk_message", message }));
}

async function cursorApiKey(): Promise<string | undefined> {
  if (process.env.CURSOR_API_KEY) return process.env.CURSOR_API_KEY;
  return (await new FileCredentialStore().load())?.apiKey;
}

async function sdkVersion(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.resolve("@cursor/sdk")));
  for (let depth = 0; depth < 5; depth += 1) {
    const manifest = Bun.file(join(directory, "package.json"));
    if (await manifest.exists()) {
      const value = await manifest.json() as { name?: string; version?: string };
      if (value.name === "@cursor/sdk" && value.version) return value.version;
    }
    directory = dirname(directory);
  }
  throw new Error("Cursor SDK package version is unavailable");
}

function modelSelection(id: string, encodedParams: string): ModelSelection {
  const values = JSON.parse(encodedParams) as unknown;
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Cursor SDK model params must be a JSON object");
  return {
    id,
    params: Object.entries(values as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([parameterId, value]) => {
      if (typeof value !== "string") throw new Error(`Cursor SDK model parameter must be a string: ${parameterId}`);
      return { id: parameterId, value };
    }),
  };
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`Cursor SDK worker option is missing: ${name}`);
  return value;
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
