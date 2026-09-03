import type { CapabilityProfile, HarnessName, NativeInvocationSnapshot, WorkerProfile } from "../domain/execution-profile.ts";

export interface HarnessCommandResult { exitCode: number; stdout: string; stderr: string; }

export interface HarnessSetupResult {
  version: string;
  invocation: NativeInvocationSnapshot;
}

export interface HarnessDriver {
  which(command: string): string | null;
  run(command: string[], cwd: string): HarnessCommandResult;
  home: string;
  isExecutable(path: string): boolean;
  canonicalPath(path: string): string;
}

export interface HarnessPreflightInput {
  profile: WorkerProfile;
  capability: CapabilityProfile;
  cwd: string;
  workspacePath: string;
  driver: HarnessDriver;
}

export interface HarnessModelInput {
  cwd: string;
  driver: HarnessDriver;
}

/** Per-harness ownership of worker protocol discovery, preflight, and immutable invocation construction. */
export interface HarnessContract {
  readonly harness: HarnessName;
  preflight(input: HarnessPreflightInput): HarnessSetupResult;
  listModels(input: HarnessModelInput): string[];
}

const VERSION = /^\d+(?:\.\d+){1,2}(?:[-+][\w.-]+)?$/;

/** Shared implementation detail for SDK adapters; callers still own when and how to apply it. */
export function verifySdkWorker(
  input: HarnessModelInput,
  workerEntryPoint: string,
  workerName: string,
  requiredHelpOptions: readonly string[],
): { executable: string; version: string } {
  const executable = resolveSdkWorker(input.driver, workerName);
  const version = requireHarnessOutput(input.driver.run, executable, [workerEntryPoint, "--version"], input.cwd, "version").trim();
  if (!VERSION.test(version)) throw new Error(`${workerName} returned an unsupported version contract: ${version}`);
  const help = requireHarnessOutput(input.driver.run, executable, [workerEntryPoint, "--help"], input.cwd, "help");
  for (const option of requiredHelpOptions) {
    if (!help.includes(option)) throw new Error(`${workerName} does not support required option ${option}`);
  }
  return { executable, version };
}

export function resolveSdkWorker(driver: HarnessDriver, workerName: string): string {
  const resolved = driver.which("bun");
  if (!resolved || !resolved.startsWith("/")) throw new Error(`${workerName} Bun executable is unavailable as an absolute path`);
  if (!driver.isExecutable(resolved)) throw new Error(`${workerName} Bun executable is not executable`);
  return resolved;
}

export function requireHarnessOutput(
  run: HarnessDriver["run"],
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
