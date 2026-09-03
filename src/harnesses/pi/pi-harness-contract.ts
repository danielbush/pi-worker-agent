import { fileURLToPath } from "node:url";
import { toolsForCapability } from "../../domain/execution-profile.ts";
import { requireHarnessOutput, type HarnessContract, type HarnessFinishInput, type HarnessResolveInput, type HarnessSetupResult } from "../harness-contract.ts";
import { parsePiModelCatalog } from "./pi-model-catalog.ts";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const PI_SDK_WORKER_ENTRY_POINT = fileURLToPath(new URL("./pi-sdk-worker.ts", import.meta.url));

/** Pi SDK contract: SDK auth/catalog probes and a sandboxed SDK-worker invocation. */
export class PiHarnessContract implements HarnessContract {
  readonly harness = "pi" as const;
  readonly executableName = "Pi SDK worker";
  readonly requiredHelpOptions = ["run", "--model", "--thinking", "--tools", "--session-dir"] as const;

  constructor(private readonly workerEntryPoint = PI_SDK_WORKER_ENTRY_POINT) {}

  static create(): PiHarnessContract {
    return new PiHarnessContract();
  }

  probeArgs(args: readonly string[]): string[] {
    return [this.workerEntryPoint, ...args];
  }

  resolveExecutable(input: HarnessResolveInput): string {
    const resolved = input.which("bun");
    if (!resolved || !resolved.startsWith("/")) throw new Error("Pi SDK worker Bun executable is unavailable as an absolute path");
    if (!input.isExecutable(resolved)) throw new Error("Pi SDK worker Bun executable is not executable");
    return resolved;
  }

  listModels(input: Pick<HarnessFinishInput, "executable" | "cwd" | "run">): string[] {
    return parsePiModelCatalog(requireHarnessOutput(input.run, input.executable, this.probeArgs(["--list-models"]), input.cwd, "model catalog"));
  }

  finish(input: HarnessFinishInput): HarnessSetupResult {
    const { profile, capability, cwd, executable, version, run } = input;
    const authentication = requireHarnessOutput(run, executable, this.probeArgs(["auth", "check", "--model", profile.model, "--json"]), cwd, "authentication");
    if (!/"status"\s*:\s*"ready"|\bready\b/i.test(authentication)) throw new Error("Pi SDK authentication check returned an unknown status");
    const catalog = requireHarnessOutput(run, executable, this.probeArgs(["--list-models", profile.model]), cwd, "model catalog");
    const [provider, model] = profile.model.split("/", 2);
    if (!provider || !model || !catalog.includes(provider) || !catalog.includes(model)) throw new Error(`Pi SDK model is unavailable: ${profile.model}`);
    const thinking = profile.options.thinking;
    if (!thinking || !THINKING.includes(thinking as typeof THINKING[number])) {
      throw new Error(`Pi profile has invalid thinking value: ${thinking ?? "missing"}`);
    }
    return {
      version,
      invocation: {
        executable,
        args: [this.workerEntryPoint, "run", "--tools", toolsForCapability(capability).join(","), "--model", profile.model, "--thinking", thinking],
      },
    };
  }
}
