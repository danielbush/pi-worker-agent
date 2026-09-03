import { join } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  getPackageDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type PiThinkingLevel = typeof THINKING_LEVELS[number];
const THINKING = new Set<string>(THINKING_LEVELS);

export async function main(args: string[]): Promise<number> {
  try {
    if (args.length === 1 && args[0] === "--version") {
      const manifest = await Bun.file(join(getPackageDir(), "package.json")).json() as { version?: string };
      if (!manifest.version) throw new Error("Pi SDK package version is unavailable");
      console.log(manifest.version);
      return 0;
    }
    if (args.length === 1 && args[0] === "--help") {
      console.log("run --model --thinking --tools --session-dir -- <prompt>\n--list-models\nauth check --model --json");
      return 0;
    }

    const agentDir = process.env.PI_CODING_AGENT_DIR ?? getAgentDir();
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      modelsStorePath: join(agentDir, "models-store.json"),
      allowModelNetwork: false,
    });

    if (args[0] === "--list-models") {
      const filter = args[1];
      const available = await modelRuntime.getAvailable();
      for (const model of available) {
        const id = `${model.provider}/${model.id}`;
        if (!filter || id.includes(filter)) console.log(id);
      }
      return 0;
    }
    if (args[0] === "auth" && args[1] === "check") {
      const modelId = option(args, "--model");
      const model = resolveModel(modelRuntime, modelId);
      const available = await modelRuntime.getAvailable(model.provider);
      const ready = available.some((candidate) => candidate.provider === model.provider && candidate.id === model.id);
      console.log(JSON.stringify({ status: ready ? "ready" : "unavailable", model: modelId }));
      return ready ? 0 : 1;
    }
    if (args[0] !== "run") throw new Error("Pi SDK worker requires run, auth check, --list-models, --help, or --version");

    const modelId = option(args, "--model");
    const thinking = option(args, "--thinking");
    if (!THINKING.has(thinking)) throw new Error(`Invalid Pi thinking level: ${thinking}`);
    const tools = option(args, "--tools").split(",").filter(Boolean);
    const sessionDirectory = option(args, "--session-dir");
    const separator = args.indexOf("--");
    const prompt = separator >= 0 ? args.slice(separator + 1).join(" ") : "";
    if (!prompt) throw new Error("Pi SDK worker prompt is missing");

    const cwd = process.cwd();
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true } });
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model: resolveModel(modelRuntime, modelId),
      thinkingLevel: thinking as PiThinkingLevel,
      tools,
      modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.create(cwd, sessionDirectory),
      settingsManager,
    });

    console.log(JSON.stringify({
      type: "session",
      version: 1,
      id: session.sessionId,
      timestamp: new Date().toISOString(),
      cwd,
    }));
    const unsubscribe = session.subscribe((event) => emitSdkEvent(event));
    try {
      await session.prompt(prompt, { expandPromptTemplates: false });
      await settingsManager.flush();
    } finally {
      unsubscribe();
      session.dispose();
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    return 1;
  }
}

function resolveModel(modelRuntime: ModelRuntime, value: string) {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) throw new Error(`Invalid Pi model id: ${value}`);
  const model = modelRuntime.getModel(value.slice(0, slash), value.slice(slash + 1));
  if (!model) throw new Error(`Pi SDK model is unavailable: ${value}`);
  return model;
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`Pi SDK worker option is missing: ${name}`);
  return value;
}

/** Projects typed SDK events onto the narrow JSONL boundary consumed by the detached runner. */
export function emitSdkEvent(event: AgentSessionEvent): void {
  switch (event.type) {
    case "message_start":
    case "message_end":
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
    case "agent_settled":
      console.log(JSON.stringify(event));
      break;
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta" || update.type === "thinking_delta") {
        console.log(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: update.type, delta: update.delta } }));
      }
      break;
    }
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
