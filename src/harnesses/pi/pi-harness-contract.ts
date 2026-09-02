import { toolsForCapability } from "../../domain/execution-profile.ts";
import { requireHarnessOutput, type HarnessContract, type HarnessFinishInput, type HarnessSetupResult } from "../harness-contract.ts";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Pi CLI contract: auth check, provider/model catalog, thinking, and json-mode argv. */
export class PiHarnessContract implements HarnessContract {
  readonly harness = "pi" as const;
  readonly executableName = "pi";
  readonly requiredHelpOptions = ["--mode", "--print", "--model", "--thinking", "--tools"] as const;

  static create(): PiHarnessContract {
    return new PiHarnessContract();
  }

  finish(input: HarnessFinishInput): HarnessSetupResult {
    const { profile, capability, cwd, executable, version, run } = input;
    const authentication = requireHarnessOutput(run, executable, ["auth", "check", "--model", profile.model, "--json"], cwd, "authentication");
    if (!/"status"\s*:\s*"ready"|\bready\b/i.test(authentication)) throw new Error("pi authentication check returned an unknown status");
    const catalog = requireHarnessOutput(run, executable, ["--list-models", profile.model], cwd, "model catalog");
    const [provider, model] = profile.model.split("/", 2);
    if (!provider || !model || !catalog.includes(provider) || !catalog.includes(model)) throw new Error(`Pi model is unavailable: ${profile.model}`);
    const thinking = profile.options.thinking;
    if (!thinking || !THINKING.includes(thinking as typeof THINKING[number])) {
      throw new Error(`Pi profile has invalid thinking value: ${thinking ?? "missing"}`);
    }
    return {
      version,
      invocation: {
        executable,
        args: ["--mode", "json", "--print", "--tools", toolsForCapability(capability).join(","), "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-approve", "--model", profile.model, "--thinking", thinking],
      },
    };
  }
}
