import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessName, NativeInvocationSnapshot } from "../../domain/execution-profile.ts";
import { WorkerSandbox, type WorkerSandboxState } from "./worker-sandbox.ts";

export interface NativeHarnessInvocation {
  cwd: string;
  model: string;
  effortLevel: string;
  tools: string[];
  prompt: string;
  sessionDirectory: string;
  temporaryDirectory: string;
  writablePaths: string[];
  harness: HarnessName;
  nativeInvocation: NativeInvocationSnapshot;
}

export interface NullNativeHarnessOutput { pid?: number; stdoutLines?: string[]; stderr?: string; exitCode?: number; }
export interface NativeHarnessState { invocations: NativeHarnessInvocation[]; environments: Record<string, string>[]; sandbox: WorkerSandboxState; killed: boolean; }
export interface NativeHarnessProcess {
  pid: number;
  consumeLines(consume: (line: string) => Promise<void>): Promise<void>;
  stderr(): Promise<string>;
  exited(): Promise<number>;
  kill(): void;
}
interface NativeProcess { pid: number; stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; exited: Promise<number>; kill(): void; }
interface NativeProcessDriver {
  spawn(command: string[], options: { cwd: string; stdin: "ignore"; stdout: "pipe"; stderr: "pipe"; env: Record<string, string>; }): NativeProcess;
}
interface PrivateConfigDriver {
  provisionPi(target: string): Promise<void>;
  provisionCursor(privateHome: string): Promise<void>;
  remove(path: string): Promise<void>;
  environment(): NodeJS.ProcessEnv;
}

/** INFRASTRUCTURE_WRAPPER: owns one native process, selected-harness credentials, and JSONL/stdout. */
export class NativeHarness {
  private readonly invocations: NativeHarnessInvocation[] = [];
  private readonly environments: Record<string, string>[] = [];
  private killed = false;

  constructor(private readonly driver: NativeProcessDriver, private readonly sandbox: WorkerSandbox, private readonly privateConfig: PrivateConfigDriver) {}

  static create(): NativeHarness {
    return new NativeHarness(Bun as unknown as NativeProcessDriver, WorkerSandbox.create(), {
      provisionPi: async (target) => {
        await mkdir(target, { recursive: true, mode: 0o700 });
        const source = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
        for (const name of ["auth.json", "settings.json", "models-store.json"]) {
          try {
            const destination = join(target, name);
            await copyFile(join(source, name), destination);
            await chmod(destination, 0o600);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
      },
      provisionCursor: async (privateHome) => {
        // CLI scratch only. Host login lives in the macOS keychain and is not a
        // ~/.cursor/auth.json we can copy the way Pi copies ~/.pi/agent/auth.json.
        await mkdir(join(privateHome, ".cursor"), { recursive: true, mode: 0o700 });
      },
      remove: async (path) => { await rm(path, { recursive: true, force: true }); },
      environment: () => process.env,
    });
  }

  static createNull(output: NullNativeHarnessOutput = {}): NativeHarness {
    return new NativeHarness({
      spawn: () => ({ pid: output.pid ?? 1234, stdout: textStream(`${(output.stdoutLines ?? []).join("\n")}\n`), stderr: textStream(output.stderr ?? ""), exited: Promise.resolve(output.exitCode ?? 0), kill: () => {} }),
    }, WorkerSandbox.createNull(), { provisionPi: async () => {}, provisionCursor: async () => {}, remove: async () => {}, environment: () => ({ PATH: "/null/bin", MANAGER_SECRET: "must-not-leak", CURSOR_API_KEY: "cursor-selected" }) });
  }

  get state(): NativeHarnessState { return { invocations: structuredClone(this.invocations), environments: structuredClone(this.environments), sandbox: this.sandbox.state, killed: this.killed }; }

  async start(invocation: NativeHarnessInvocation): Promise<NativeHarnessProcess> {
    this.invocations.push(structuredClone(invocation));
    const privateHome = join(invocation.temporaryDirectory, "home");
    const privateConfigDirectory = join(privateHome, ".pi", "agent");
    const native = [invocation.nativeInvocation.executable, ...invocation.nativeInvocation.args];
    native.push(...(invocation.harness === "cursor-agent" ? [invocation.prompt] : ["--session-dir", invocation.sessionDirectory, "--", invocation.prompt]));
    const command = await this.sandbox.wrap(native, {
      writablePaths: [...invocation.writablePaths, invocation.temporaryDirectory],
      temporaryDirectory: invocation.temporaryDirectory,
      deniedReadPaths: invocation.harness === "pi" ? ["~/.config/cursor", "~/.cursor"] : ["~/.pi", "~/.config/cursor", "~/.cursor"],
    });

    let child: NativeProcess;
    try {
      // Provision only the selected harness after executable/contract/sandbox preflight.
      await mkdirPrivateHome(this.privateConfig, privateHome, invocation.harness, privateConfigDirectory);
      const env = workerEnvironment(this.privateConfig.environment(), invocation.harness, invocation.temporaryDirectory, privateConfigDirectory, privateHome);
      this.environments.push({ ...env });
      child = this.driver.spawn(command, { cwd: invocation.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
    } catch (error) {
      await Promise.allSettled([this.sandbox.reset(), this.privateConfig.remove(privateHome)]);
      throw error;
    }
    const cleanup = async () => { await Promise.allSettled([this.sandbox.reset(), this.privateConfig.remove(privateHome)]); };
    const exited = child.exited.then(async (exitCode) => { await cleanup(); return exitCode; }, async (error) => { await cleanup(); throw error; });
    return {
      pid: child.pid,
      consumeLines: (consume) => consumeJsonLines(child.stdout, consume),
      stderr: () => new Response(child.stderr).text(),
      exited: () => exited,
      kill: () => { this.killed = true; child.kill(); },
    };
  }
}

export function workerEnvironment(source: NodeJS.ProcessEnv, harness: HarnessName, temporaryDirectory: string, piDirectory: string, privateHome = join(temporaryDirectory, "home")): Record<string, string> {
  const cursorKeys = Boolean(source.CURSOR_API_KEY || source.CURSOR_AUTH_TOKEN);
  const env: Record<string, string> = { PATH: source.PATH ?? "/usr/bin:/bin", TMPDIR: temporaryDirectory };
  env.HOME = harness === "cursor-agent" && !cursorKeys ? source.HOME ?? homedir() : privateHome;
  for (const key of ["LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"] as const) {
    if (source[key]) env[key] = source[key]!;
  }
  if (harness === "pi") env.PI_CODING_AGENT_DIR = piDirectory;
  if (harness === "cursor-agent") {
    env.XDG_CONFIG_HOME = join(privateHome, ".config");
    env.CURSOR_CONFIG_DIR = join(privateHome, ".config", "cursor");
    env.CURSOR_DATA_DIR = join(privateHome, ".cursor");
    if (cursorKeys) {
      env.AGENT_CLI_CREDENTIAL_STORE = "memory";
      if (source.CURSOR_API_KEY) env.CURSOR_API_KEY = source.CURSOR_API_KEY;
      if (source.CURSOR_AUTH_TOKEN) env.CURSOR_AUTH_TOKEN = source.CURSOR_AUTH_TOKEN;
    }
  }
  return env;
}

async function mkdirPrivateHome(driver: PrivateConfigDriver, privateHome: string, harness: HarnessName, piDirectory: string): Promise<void> {
  if (harness === "pi") await driver.provisionPi(piDirectory);
  else await driver.provisionCursor(privateHome);
}

function textStream(text: string): ReadableStream<Uint8Array> { return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } }); }
async function consumeJsonLines(stream: ReadableStream<Uint8Array>, consume: (line: string) => Promise<void>): Promise<void> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let pending = "";
  while (true) { const { done, value } = await reader.read(); pending += decoder.decode(value, { stream: !done }); const lines = pending.split("\n"); pending = lines.pop() ?? ""; for (const line of lines) if (line.trim()) await consume(line); if (done) break; }
  if (pending.trim()) await consume(pending);
}
