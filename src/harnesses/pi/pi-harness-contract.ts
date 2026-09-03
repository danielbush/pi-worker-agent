import { fileURLToPath } from "node:url";
import { toolsForCapability } from "../../domain/execution-profile.ts";
import { requireHarnessOutput, resolveSdkWorker, verifySdkWorker, type HarnessContract, type HarnessModelInput, type HarnessPreflightInput, type HarnessSetupResult } from "../harness-contract.ts";
import { parsePiModelCatalog } from "./pi-model-catalog.ts";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const REQUIRED_HELP_OPTIONS = ["run", "--model", "--thinking", "--tools", "--session-dir"] as const;
export const PI_SDK_WORKER_ENTRY_POINT = fileURLToPath(new URL("./pi-sdk-worker.ts", import.meta.url));

/** Pi SDK contract: owns its SDK-worker protocol, auth/catalog probes, and invocation snapshot. */
export class PiHarnessContract implements HarnessContract {
  readonly harness = "pi" as const;

  constructor(private readonly workerEntryPoint = PI_SDK_WORKER_ENTRY_POINT) {}

  static create(): PiHarnessContract {
    return new PiHarnessContract();
  }

  listModels(input: HarnessModelInput): string[] {
    const executable = resolveSdkWorker(input.driver, "Pi SDK worker");
    return parsePiModelCatalog(requireHarnessOutput(input.driver.run, executable, [this.workerEntryPoint, "--list-models"], input.cwd, "model catalog"));
  }

  preflight(input: HarnessPreflightInput): HarnessSetupResult {
    const { profile, capability, cwd, driver } = input;
    const { executable, version } = verifySdkWorker(input, this.workerEntryPoint, "Pi SDK worker", REQUIRED_HELP_OPTIONS);
    const authentication = requireHarnessOutput(driver.run, executable, [this.workerEntryPoint, "auth", "check", "--model", profile.model, "--json"], cwd, "authentication");
    if (!/"status"\s*:\s*"ready"|\bready\b/i.test(authentication)) throw new Error("Pi SDK authentication check returned an unknown status");
    const catalog = requireHarnessOutput(driver.run, executable, [this.workerEntryPoint, "--list-models", profile.model], cwd, "model catalog");
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
