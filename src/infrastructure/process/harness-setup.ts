import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CapabilityProfile, NativeInvocationSnapshot, WorkerProfile } from "../../domain/execution-profile.ts";
import { CURSOR_STREAM_CONTRACT } from "../../harnesses/cursor/cursor-stream-json.ts";
import { WorkerSandbox } from "./worker-sandbox.ts";

interface CommandResult { exitCode: number; stdout: string; stderr: string; }
interface NativeCommandDriver {
  which(command: string): string | null;
  run(command: string[], cwd: string): CommandResult;
}

export interface HarnessSetupResult {
  version: string;
  invocation: NativeInvocationSnapshot;
}

export interface NullHarnessSetupResult {
  versions?: Partial<Record<"pi" | "cursor-agent", string>>;
  piModels?: string[];
  cursorModels?: string[];
  authenticated?: boolean;
  cursorContractVerified?: boolean;
}

// No Cursor stream contract has yet been obtained from authoritative documentation or a
// successful redacted live capture. Production therefore deliberately has no supported version.
export const CURSOR_CONTRACT_DIAGNOSTIC = `${CURSOR_STREAM_CONTRACT} is unverified; obtain a redacted live capture or authoritative Cursor contract before enabling execution`;

/** INFRASTRUCTURE_WRAPPER: verifies a native harness contract and prepares immutable arguments. */
export class HarnessSetup {
  constructor(
    private readonly driver: NativeCommandDriver,
    private readonly sandbox: WorkerSandbox,
    private readonly verifiedCursorVersions: ReadonlySet<string>,
    private readonly cursorPrivateAuthenticationAvailable: boolean,
  ) {}

  static create(): HarnessSetup {
    const environmentAuthentication = Boolean(process.env.CURSOR_API_KEY || process.env.CURSOR_AUTH_TOKEN);
    const fileAuthentication = existsSync(join(process.env.CURSOR_DATA_DIR ?? join(homedir(), ".cursor"), "auth.json"));
    return new HarnessSetup({
      which: (command) => Bun.which(command),
      run: (command, cwd) => {
        const env = command[0]?.includes("cursor-agent") && !environmentAuthentication && fileAuthentication
          ? { ...process.env, AGENT_CLI_CREDENTIAL_STORE: "file" }
          : process.env;
        const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe", env });
        return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
      },
    }, WorkerSandbox.create(), new Set(), environmentAuthentication || fileAuthentication);
  }

  static createNull(result: NullHarnessSetupResult = {}): HarnessSetup {
    const authenticated = result.authenticated ?? true;
    const piVersion = result.versions?.pi ?? "1.0.0-test";
    const cursorVersion = result.versions?.["cursor-agent"] ?? "1.0.0-test";
    return new HarnessSetup({
      which: (command) => `/null/bin/${command}`,
      run: (command) => {
        const executable = command[0]!.split("/").at(-1)!;
        const args = command.slice(1);
        if (args.includes("--version")) return ok(executable === "pi" ? piVersion : cursorVersion);
        if (args.includes("--help")) return ok(executable === "pi" ? "--mode --print --model --thinking --tools" : "--print --output-format --stream-partial-output --model --mode --force --trust --sandbox");
        if (executable === "pi" && args[0] === "auth") return authenticated ? ok("ready") : fail("not authenticated");
        if (executable === "pi" && args[0] === "--list-models") return ok((result.piModels ?? ["openai-codex/gpt-5.6-sol"]).join("\n"));
        if (executable === "cursor-agent" && args[0] === "status") return authenticated ? ok("Login successful") : fail("not logged in");
        if (executable === "cursor-agent" && args[0] === "--list-models") return ok((result.cursorModels ?? ["cursor-grok-4.5-high"]).join("\n"));
        return fail("unexpected command");
      },
    }, WorkerSandbox.createNull(), result.cursorContractVerified === false ? new Set() : new Set([cursorVersion]), authenticated);
  }

  verify(profile: WorkerProfile, capability: CapabilityProfile, cwd: string): HarnessSetupResult {
    this.sandbox.preflight();
    const executableName = profile.harness === "pi" ? "pi" : "cursor-agent";
    const resolved = this.driver.which(executableName);
    if (!resolved || !resolved.startsWith("/")) throw new Error(`${executableName} executable is unavailable as an absolute path`);
    const version = this.require(resolved, ["--version"], cwd, "version").trim();
    if (!/^\d+(?:\.\d+){1,2}(?:[-+][\w.-]+)?$/.test(version)) {
      throw new Error(`${executableName} returned an unsupported version contract: ${version}`);
    }
    const help = this.require(resolved, ["--help"], cwd, "help");
    const required = profile.harness === "pi"
      ? ["--mode", "--print", "--model", "--thinking", "--tools"]
      : ["--print", "--output-format", "--stream-partial-output", "--model", "--mode", "--force", "--trust", "--sandbox"];
    for (const option of required) if (!help.includes(option)) throw new Error(`${executableName} does not support required option ${option}`);

    if (profile.harness === "pi") {
      const authentication = this.require(resolved, ["auth", "check", "--model", profile.model, "--json"], cwd, "authentication");
      if (!/"status"\s*:\s*"ready"|\bready\b/i.test(authentication)) throw new Error("pi authentication check returned an unknown status");
      const catalog = this.require(resolved, ["--list-models", profile.model], cwd, "model catalog");
      const [provider, model] = profile.model.split("/", 2);
      if (!provider || !model || !catalog.includes(provider) || !catalog.includes(model)) throw new Error(`Pi model is unavailable: ${profile.model}`);
      const thinking = profile.options.thinking;
      if (!thinking || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking)) throw new Error(`Pi profile has invalid thinking value: ${thinking ?? "missing"}`);
      return { version, invocation: { executable: resolved, args: ["--mode", "json", "--print", "--tools", toolsForCapability(capability).join(","), "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-approve", "--model", profile.model, "--thinking", thinking] } };
    }

    if (!this.verifiedCursorVersions.has(version)) throw new Error(`Cursor Agent ${version} ${CURSOR_CONTRACT_DIAGNOSTIC}`);
    if (!this.cursorPrivateAuthenticationAvailable) throw new Error("cursor-agent has no authentication that can be provisioned into a private worker HOME");
    const authentication = this.require(resolved, ["status"], cwd, "authentication");
    if (!/login successful|logged in/i.test(authentication)) throw new Error("cursor-agent authentication check returned an unknown status");
    const catalog = this.require(resolved, ["--list-models"], cwd, "model catalog");
    if (!catalog.split(/\s+/).some((entry) => entry === profile.model)) throw new Error(`Cursor model is unavailable: ${profile.model}`);
    if (capability === "test") throw new Error("Cursor Agent cannot enforce the test capability profile; refusing to launch");
    const args = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--model", profile.model, "--trust", "--sandbox", "disabled"];
    args.push(...(capability === "read-only" ? ["--mode", "plan"] : ["--force"]));
    return { version, invocation: { executable: resolved, args } };
  }

  private require(resolvedExecutable: string, args: string[], cwd: string, contract: string): string {
    const result = this.driver.run([resolvedExecutable, ...args], cwd);
    if (result.exitCode !== 0) throw new Error(`${resolvedExecutable} ${contract} check failed: ${(result.stderr || result.stdout).trim() || `exit ${result.exitCode}`}`);
    return result.stdout || result.stderr;
  }
}

export function toolsForCapability(capability: CapabilityProfile): string[] {
  const read = ["read", "grep", "find", "ls"];
  if (capability === "code") return [...read, "write", "edit", "bash"];
  if (capability === "test") return [...read, "bash"];
  return read;
}

function ok(stdout: string): CommandResult { return { exitCode: 0, stdout, stderr: "" }; }
function fail(stderr: string): CommandResult { return { exitCode: 1, stdout: "", stderr }; }
