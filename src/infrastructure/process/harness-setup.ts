import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { toolsForCapability, type CapabilityProfile, type HarnessName, type WorkerProfile } from "../../domain/execution-profile.ts";
import { CursorHarnessContract } from "../../harnesses/cursor/cursor-harness-contract.ts";
import { requireHarnessOutput, type HarnessCommandResult, type HarnessContract, type HarnessSetupResult } from "../../harnesses/harness-contract.ts";
import { PiHarnessContract } from "../../harnesses/pi/pi-harness-contract.ts";
import { WorkerSandbox } from "./worker-sandbox.ts";

interface NativeCommandDriver {
  which(command: string): string | null;
  run(command: string[], cwd: string): HarnessCommandResult;
}

export interface NullHarnessSetupResult {
  versions?: Partial<Record<HarnessName, string>>;
  piModels?: string[];
  cursorModels?: string[];
  authenticated?: boolean;
  cursorContractVerified?: boolean;
  contracts?: readonly HarnessContract[];
}

export type { HarnessSetupResult };

export { CURSOR_CONTRACT_DIAGNOSTIC } from "../../harnesses/cursor/cursor-harness-contract.ts";
export { toolsForCapability };

const VERSION = /^\d+(?:\.\d+){1,2}(?:[-+][\w.-]+)?$/;

/** INFRASTRUCTURE_WRAPPER: verifies a named harness contract and prepares immutable arguments. */
export class HarnessSetup {
  private readonly contracts: ReadonlyMap<string, HarnessContract>;

  constructor(
    private readonly driver: NativeCommandDriver,
    private readonly sandbox: WorkerSandbox,
    contracts: readonly HarnessContract[],
  ) {
    this.contracts = new Map(contracts.map((contract) => [contract.harness, contract]));
  }

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
    }, WorkerSandbox.create(), productionContracts(new Set(), environmentAuthentication || fileAuthentication));
  }

  static createNull(result: NullHarnessSetupResult = {}): HarnessSetup {
    const authenticated = result.authenticated ?? true;
    const piVersion = result.versions?.pi ?? "1.0.0-test";
    const cursorVersion = result.versions?.["cursor-agent"] ?? "1.0.0-test";
    const verifiedCursorVersions = result.cursorContractVerified === false ? new Set<string>() : new Set([cursorVersion]);
    return new HarnessSetup({
      which: (command) => `/null/bin/${command}`,
      run: (command) => {
        const executable = command[0]!.split("/").at(-1)!;
        const args = command.slice(1);
        if (args.includes("--version")) return ok(executable === "pi" ? piVersion : cursorVersion);
        if (args.includes("--help")) return ok(executable === "pi" ? "--mode --print --model --thinking --tools" : "--print --output-format --stream-partial-output --model --mode --force --trust --sandbox --workspace");
        if (executable === "pi" && args[0] === "auth") return authenticated ? ok("ready") : fail("not authenticated");
        if (executable === "pi" && args[0] === "--list-models") return ok((result.piModels ?? ["openai-codex/gpt-5.6-sol"]).join("\n"));
        if (executable === "cursor-agent" && args[0] === "status") return authenticated ? ok("Login successful") : fail("not logged in");
        if (executable === "cursor-agent" && args[0] === "--list-models") {
          return ok(["Available models", ...(result.cursorModels ?? ["cursor-grok-4.5-high"]).map((id) => `${id} - ${id}`)].join("\n"));
        }
        return fail("unexpected command");
      },
    }, WorkerSandbox.createNull(), result.contracts ?? productionContracts(verifiedCursorVersions, authenticated));
  }

  verify(profile: WorkerProfile, capability: CapabilityProfile, cwd: string, workspacePath = cwd): HarnessSetupResult {
    this.sandbox.preflight();
    const contract = this.contracts.get(profile.harness);
    if (!contract) throw new Error(`Unknown harness: ${profile.harness}`);
    const resolved = this.driver.which(contract.executableName);
    if (!resolved || !resolved.startsWith("/")) throw new Error(`${contract.executableName} executable is unavailable as an absolute path`);
    const version = requireHarnessOutput(this.driver.run, resolved, ["--version"], cwd, "version").trim();
    if (!VERSION.test(version)) throw new Error(`${contract.executableName} returned an unsupported version contract: ${version}`);
    const help = requireHarnessOutput(this.driver.run, resolved, ["--help"], cwd, "help");
    for (const option of contract.requiredHelpOptions) {
      if (!help.includes(option)) throw new Error(`${contract.executableName} does not support required option ${option}`);
    }
    return contract.finish({ profile, capability, cwd, workspacePath, executable: resolved, version, run: this.driver.run });
  }
}

function productionContracts(verifiedCursorVersions: ReadonlySet<string>, cursorPrivateAuthenticationAvailable: boolean): HarnessContract[] {
  return [
    PiHarnessContract.create(),
    CursorHarnessContract.create({ verifiedVersions: verifiedCursorVersions, privateAuthenticationAvailable: cursorPrivateAuthenticationAvailable }),
  ];
}

function ok(stdout: string): HarnessCommandResult { return { exitCode: 0, stdout, stderr: "" }; }
function fail(stderr: string): HarnessCommandResult { return { exitCode: 1, stdout: "", stderr }; }
