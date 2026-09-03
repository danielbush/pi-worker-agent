import { accessSync, constants, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { toolsForCapability, type CapabilityProfile, type HarnessName, type WorkerProfile } from "../../domain/execution-profile.ts";
import { CursorHarnessContract } from "../../harnesses/cursor/cursor-harness-contract.ts";
import type { HarnessCommandResult, HarnessContract, HarnessDriver, HarnessSetupResult } from "../../harnesses/harness-contract.ts";
import { PiHarnessContract } from "../../harnesses/pi/pi-harness-contract.ts";
import { HarnessSandboxCatalog } from "./harness-sandbox.ts";

export interface NullHarnessSetupResult {
  versions?: Partial<Record<HarnessName, string>>;
  piModels?: string[];
  cursorModels?: string[];
  authenticated?: boolean;
  contracts?: readonly HarnessContract[];
}

export interface HarnessModelListing {
  harness: HarnessName;
  models: string[];
  error?: string;
}

export type { HarnessSetupResult };

export { toolsForCapability };

/** INFRASTRUCTURE_WRAPPER: verifies a named harness contract and prepares immutable arguments. */
export class HarnessSetup {
  private readonly contracts: ReadonlyMap<string, HarnessContract>;

  constructor(
    private readonly driver: HarnessDriver,
    private readonly sandboxCatalog: HarnessSandboxCatalog,
    contracts: readonly HarnessContract[],
  ) {
    this.contracts = new Map(contracts.map((contract) => [contract.harness, contract]));
  }

  static create(): HarnessSetup {
    return new HarnessSetup({
      which: (command) => Bun.which(command),
      home: homedir(),
      isExecutable: (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } },
      canonicalPath: (path) => { try { return realpathSync(path); } catch { return path; } },
      run: (command, cwd) => {
        const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
        return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
      },
    }, HarnessSandboxCatalog.create(), productionContracts());
  }

  static createNull(result: NullHarnessSetupResult = {}): HarnessSetup {
    const authenticated = result.authenticated ?? true;
    const piVersion = result.versions?.pi ?? "1.0.0-test";
    const cursorVersion = result.versions?.["cursor-agent"] ?? "1.0.0-test";
    return new HarnessSetup({
      which: (command) => `/null/bin/${command}`,
      home: "/null",
      isExecutable: () => true,
      canonicalPath: (path) => path,
      run: (command) => {
        const executable = command[0]!.split("/").at(-1)!;
        const piSdk = command[1]?.endsWith("/pi-sdk-worker.ts") ?? false;
        const cursorSdk = command[1]?.endsWith("/cursor-sdk-worker.ts") ?? false;
        const args = command.slice(piSdk || cursorSdk ? 2 : 1);
        if (args.includes("--version")) return ok(piSdk ? piVersion : cursorVersion);
        if (args.includes("--help")) return ok(piSdk ? "run --model --thinking --tools --session-dir" : "run --model --params --tools --session-dir probe-models probe-model probe-auth");
        if (piSdk && args[0] === "auth") return authenticated ? ok('{"status":"ready"}') : fail("not authenticated");
        if (piSdk && args[0] === "--list-models") return ok((result.piModels ?? ["openai-codex/gpt-5.6-sol"]).join("\n"));
        if (cursorSdk && args[0] === "probe-auth") return authenticated ? ok('{"status":"ready"}') : fail("not authenticated");
        if (cursorSdk && args[0] === "probe-models") return authenticated ? ok((result.cursorModels ?? ["grok-4.5"]).join("\n")) : fail("not authenticated");
        if (cursorSdk && args[0] === "probe-model") {
          if (!authenticated) return fail("not authenticated");
          const model = args[args.indexOf("--model") + 1];
          return (result.cursorModels ?? ["grok-4.5"]).includes(model!) ? ok(model!) : fail(`Cursor SDK model is unavailable: ${model}`);
        }
        return fail("unexpected command");
      },
    }, HarnessSandboxCatalog.createNull(), result.contracts ?? productionContracts());
  }

  verify(profile: WorkerProfile, capability: CapabilityProfile, cwd: string, workspacePath = cwd): HarnessSetupResult {
    this.sandboxCatalog.sandbox(profile.harness).preflight();
    const contract = this.contracts.get(profile.harness);
    if (!contract) throw new Error(`Unknown harness: ${profile.harness}`);
    return contract.preflight({ profile, capability, cwd, workspacePath, driver: this.driver });
  }

  discoverModels(harness?: HarnessName, cwd = process.cwd()): HarnessModelListing[] {
    const selected = harness ? [harness] : [...this.contracts.keys()];
    return selected.map((name) => {
      const contract = this.contracts.get(name);
      if (!contract) throw new Error(`Unknown harness: ${name}`);
      try {
        return { harness: contract.harness, models: contract.listModels({ cwd, driver: this.driver }) };
      } catch (error) {
        return { harness: contract.harness, models: [], error: error instanceof Error ? error.message : String(error) };
      }
    });
  }
}

function productionContracts(): HarnessContract[] {
  return [PiHarnessContract.create(), CursorHarnessContract.create()];
}

function ok(stdout: string): HarnessCommandResult { return { exitCode: 0, stdout, stderr: "" }; }
function fail(stderr: string): HarnessCommandResult { return { exitCode: 1, stdout: "", stderr }; }
