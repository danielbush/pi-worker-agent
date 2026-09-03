import type { CapabilityProfile, HarnessName, NativeInvocationSnapshot, WorkerProfile } from "../domain/execution-profile.ts";

export interface HarnessCommandResult { exitCode: number; stdout: string; stderr: string; }

export interface HarnessSetupResult {
  version: string;
  invocation: NativeInvocationSnapshot;
}

export interface HarnessFinishInput {
  profile: WorkerProfile;
  capability: CapabilityProfile;
  cwd: string;
  workspacePath: string;
  executable: string;
  version: string;
  run(command: string[], cwd: string): HarnessCommandResult;
}

export interface HarnessResolveInput {
  which(command: string): string | null;
  run(command: string[], cwd: string): HarnessCommandResult;
  home: string;
  isExecutable(path: string): boolean;
  canonicalPath(path: string): string;
}

/** Per-harness rules for proving a live CLI can run a worker profile and for building its argv snapshot. */
export interface HarnessContract {
  readonly harness: HarnessName;
  readonly executableName: string;
  readonly requiredHelpOptions: readonly string[];
  probeArgs(args: readonly string[]): string[];
  resolveExecutable(input: HarnessResolveInput): string;
  listModels(input: Pick<HarnessFinishInput, "executable" | "cwd" | "run">): string[];
  finish(input: HarnessFinishInput): HarnessSetupResult;
}

export function requireHarnessOutput(
  run: HarnessFinishInput["run"],
  executable: string,
  args: readonly string[],
  cwd: string,
  check: string,
): string {
  const result = run([executable, ...args], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`${executable} ${check} check failed: ${(result.stderr || result.stdout).trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout || result.stderr;
}
