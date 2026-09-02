import { cursorCatalogHasModel } from "./cursor-model-catalog.ts";
import { CURSOR_STREAM_CONTRACT } from "./cursor-stream-json.ts";
import { requireHarnessOutput, type HarnessContract, type HarnessFinishInput, type HarnessSetupResult } from "../harness-contract.ts";

export interface CursorHarnessContractOptions {
  verifiedVersions: ReadonlySet<string>;
  privateAuthenticationAvailable: boolean;
}

// No Cursor stream contract has yet been obtained from authoritative documentation or a
// successful redacted live capture. Production therefore deliberately has no supported version.
export const CURSOR_CONTRACT_DIAGNOSTIC = `${CURSOR_STREAM_CONTRACT} is unverified; obtain a redacted live capture or authoritative Cursor contract before enabling execution`;

/** Cursor Agent CLI contract: version allowlist, private auth, catalog ids, and print-mode argv. */
export class CursorHarnessContract implements HarnessContract {
  readonly harness = "cursor-agent" as const;
  readonly executableName = "cursor-agent";
  readonly requiredHelpOptions = ["--print", "--output-format", "--stream-partial-output", "--model", "--mode", "--force", "--trust", "--sandbox"] as const;

  constructor(private readonly options: CursorHarnessContractOptions) {}

  static create(options: CursorHarnessContractOptions): CursorHarnessContract {
    return new CursorHarnessContract(options);
  }

  finish(input: HarnessFinishInput): HarnessSetupResult {
    const { profile, capability, cwd, executable, version, run } = input;
    if (!this.options.verifiedVersions.has(version)) {
      throw new Error(`Cursor Agent ${version} ${CURSOR_CONTRACT_DIAGNOSTIC}`);
    }
    if (!this.options.privateAuthenticationAvailable) {
      throw new Error("cursor-agent has no authentication that can be provisioned into a private worker HOME");
    }
    const authentication = requireHarnessOutput(run, executable, ["status"], cwd, "authentication");
    if (!/login successful|logged in/i.test(authentication)) throw new Error("cursor-agent authentication check returned an unknown status");
    const catalog = requireHarnessOutput(run, executable, ["--list-models"], cwd, "model catalog");
    if (!cursorCatalogHasModel(catalog, profile.model)) throw new Error(`Cursor model is unavailable: ${profile.model}`);
    if (capability === "test") throw new Error("Cursor Agent cannot enforce the test capability profile; refusing to launch");
    const args = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--model", profile.model, "--trust", "--sandbox", "disabled"];
    args.push(...(capability === "read-only" ? ["--mode", "plan"] : ["--force"]));
    return { version, invocation: { executable, args } };
  }
}
