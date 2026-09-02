import { createCursorExecutableLocator, resolveCursorExecutable } from "./cursor-executable.ts";
import { cursorCatalogHasModel } from "./cursor-model-catalog.ts";
import { CURSOR_STREAM_CONTRACT } from "./cursor-stream-json.ts";
import { requireHarnessOutput, type HarnessContract, type HarnessFinishInput, type HarnessResolveInput, type HarnessSetupResult } from "../harness-contract.ts";

export interface CursorHarnessContractOptions {
  verifiedVersions: ReadonlySet<string>;
}

export const CURSOR_CONTRACT_DIAGNOSTIC = `${CURSOR_STREAM_CONTRACT} does not include this Cursor Agent version`;

/** Cursor Agent CLI contract: version allowlist, host login or env keys, catalog ids, and print-mode argv. */
export class CursorHarnessContract implements HarnessContract {
  readonly harness = "cursor-agent" as const;
  readonly executableName = "cursor-agent";
  readonly requiredHelpOptions = ["--print", "--output-format", "--stream-partial-output", "--model", "--mode", "--force", "--trust", "--sandbox", "--workspace"] as const;

  constructor(private readonly options: CursorHarnessContractOptions) {}

  static create(options: CursorHarnessContractOptions): CursorHarnessContract {
    return new CursorHarnessContract(options);
  }

  resolveExecutable(input: HarnessResolveInput): string {
    return resolveCursorExecutable({
      ...createCursorExecutableLocator(input.which, input.run, input.home),
      isExecutable: input.isExecutable,
      canonicalPath: input.canonicalPath,
    });
  }

  finish(input: HarnessFinishInput): HarnessSetupResult {
    const { profile, capability, cwd, executable, version, run } = input;
    if (!this.options.verifiedVersions.has(version)) {
      throw new Error(`Cursor Agent ${version} ${CURSOR_CONTRACT_DIAGNOSTIC}`);
    }
    const authentication = requireHarnessOutput(run, executable, ["status"], cwd, "authentication");
    if (!/login successful|logged in|authenticated/i.test(authentication)) throw new Error("cursor-agent authentication check returned an unknown status");
    const catalog = requireHarnessOutput(run, executable, ["--list-models"], cwd, "model catalog");
    if (!cursorCatalogHasModel(catalog, profile.model)) throw new Error(`Cursor model is unavailable: ${profile.model}`);
    if (capability === "test") throw new Error("Cursor Agent cannot enforce the test capability profile; refusing to launch");
    if (!input.workspacePath.startsWith("/")) throw new Error("Cursor --workspace must be an absolute path");
    const args = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--model", profile.model, "--trust", "--sandbox", "disabled", "--workspace", input.workspacePath];
    args.push(...(capability === "read-only" ? ["--mode", "plan"] : ["--force"]));
    return { version, invocation: { executable, args } };
  }
}
