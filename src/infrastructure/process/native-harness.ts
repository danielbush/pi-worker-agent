import type { HarnessName, NativeInvocationSnapshot } from "../../domain/execution-profile.ts";
import { HarnessEnvironmentCatalog, type PreparedHarnessEnvironment } from "./harness-environment.ts";
import { HarnessSandboxCatalog } from "./harness-sandbox.ts";
import type { WorkerSandboxState } from "./worker-sandbox.ts";

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
export interface NativeHarnessState { invocations: NativeHarnessInvocation[]; environments: Record<string, string>[]; sandboxes: Partial<Record<HarnessName, WorkerSandboxState>>; killed: boolean; }
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

/** INFRASTRUCTURE_WRAPPER: owns one sandboxed native process and delegates harness-specific environment preparation. */
export class NativeHarness {
  private readonly invocations: NativeHarnessInvocation[] = [];
  private readonly environments: Record<string, string>[] = [];
  private killed = false;

  constructor(
    private readonly driver: NativeProcessDriver,
    private readonly sandboxCatalog: HarnessSandboxCatalog,
    private readonly environmentCatalog: HarnessEnvironmentCatalog,
  ) {}

  static create(): NativeHarness {
    return new NativeHarness(
      Bun as unknown as NativeProcessDriver,
      HarnessSandboxCatalog.create(),
      HarnessEnvironmentCatalog.create(),
    );
  }

  static createNull(output: NullNativeHarnessOutput = {}): NativeHarness {
    return new NativeHarness(
      new NullNativeProcessDriver(output),
      HarnessSandboxCatalog.createNull(),
      HarnessEnvironmentCatalog.createNull(),
    );
  }

  get state(): NativeHarnessState { return { invocations: structuredClone(this.invocations), environments: structuredClone(this.environments), sandboxes: this.sandboxCatalog.state, killed: this.killed }; }

  async start(invocation: NativeHarnessInvocation): Promise<NativeHarnessProcess> {
    this.invocations.push(structuredClone(invocation));
    const sandbox = this.sandboxCatalog.sandbox(invocation.harness);
    const native = [invocation.nativeInvocation.executable, ...invocation.nativeInvocation.args, "--session-dir", invocation.sessionDirectory, "--", invocation.prompt];
    const command = await sandbox.wrap(native, {
      writablePaths: [...invocation.writablePaths, invocation.temporaryDirectory],
      temporaryDirectory: invocation.temporaryDirectory,
      deniedReadPaths: this.environmentCatalog.deniedReadPaths(invocation.harness),
    });

    let prepared: PreparedHarnessEnvironment | undefined;
    let child: NativeProcess;
    try {
      prepared = await this.environmentCatalog.prepare(invocation.harness, { temporaryDirectory: invocation.temporaryDirectory });
      this.environments.push({ ...prepared.env });
      child = this.driver.spawn(command, { cwd: invocation.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: prepared.env });
    } catch (error) {
      await Promise.allSettled([sandbox.reset(), prepared?.cleanup()]);
      throw error;
    }
    const cleanup = async () => { await Promise.allSettled([sandbox.reset(), prepared.cleanup()]); };
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

class NullNativeProcessDriver implements NativeProcessDriver {
  constructor(private readonly output: NullNativeHarnessOutput) {}

  spawn(): NativeProcess {
    return {
      pid: this.output.pid ?? 1234,
      stdout: textStream(`${(this.output.stdoutLines ?? []).join("\n")}\n`),
      stderr: textStream(this.output.stderr ?? ""),
      exited: Promise.resolve(this.output.exitCode ?? 0),
      kill: () => {},
    };
  }
}

function textStream(text: string): ReadableStream<Uint8Array> { return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } }); }
async function consumeJsonLines(stream: ReadableStream<Uint8Array>, consume: (line: string) => Promise<void>): Promise<void> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let pending = "";
  while (true) { const { done, value } = await reader.read(); pending += decoder.decode(value, { stream: !done }); const lines = pending.split("\n"); pending = lines.pop() ?? ""; for (const line of lines) if (line.trim()) await consume(line); if (done) break; }
  if (pending.trim()) await consume(pending);
}
