import { fileURLToPath } from "node:url";
import { toolsForCapability } from "../../domain/execution-profile.ts";
import { requireHarnessOutput, resolveSdkWorker, verifySdkWorker, type HarnessContract, type HarnessModelInput, type HarnessPreflightInput, type HarnessSetupResult } from "../harness-contract.ts";

const REQUIRED_HELP_OPTIONS = ["run", "--model", "--params", "--tools", "--session-dir", "probe-models", "probe-model", "probe-auth"] as const;
export const CURSOR_SDK_WORKER_ENTRY_POINT = fileURLToPath(new URL("./cursor-sdk-worker.ts", import.meta.url));

/** Cursor SDK contract: owns its SDK-worker protocol, auth/catalog probes, and invocation snapshot. */
export class CursorHarnessContract implements HarnessContract {
  readonly harness = "cursor-agent" as const;

  constructor(private readonly workerEntryPoint = CURSOR_SDK_WORKER_ENTRY_POINT) {}

  static create(): CursorHarnessContract {
    return new CursorHarnessContract();
  }

  listModels(input: HarnessModelInput): string[] {
    const executable = resolveSdkWorker(input.driver, "Cursor SDK worker");
    return lines(requireHarnessOutput(input.driver.run, executable, [this.workerEntryPoint, "probe-models"], input.cwd, "model catalog"));
  }

  preflight(input: HarnessPreflightInput): HarnessSetupResult {
    const { profile, capability, cwd, driver } = input;
    const { executable, version } = verifySdkWorker(input, this.workerEntryPoint, "Cursor SDK worker", REQUIRED_HELP_OPTIONS);
    const authentication = requireHarnessOutput(driver.run, executable, [this.workerEntryPoint, "probe-auth"], cwd, "authentication");
    if (!/"status"\s*:\s*"ready"|\bready\b/i.test(authentication)) throw new Error("Cursor SDK authentication check returned an unknown status");
    const params = JSON.stringify(Object.fromEntries(Object.entries(profile.options).sort(([a], [b]) => a.localeCompare(b))));
    const selected = requireHarnessOutput(driver.run, executable, [this.workerEntryPoint, "probe-model", "--model", profile.model, "--params", params], cwd, "model selection").trim();
    if (selected !== profile.model) throw new Error(`Cursor SDK model is unavailable: ${profile.model}`);
    return {
      version,
      invocation: {
        executable,
        args: [this.workerEntryPoint, "run", "--tools", toolsForCapability(capability).join(","), "--model", profile.model, "--params", params],
      },
    };
  }
}

function lines(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
