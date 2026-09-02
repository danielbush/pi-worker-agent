import { rm } from "node:fs/promises";
import { join } from "node:path";
import { WorkerSandbox } from "../process/worker-sandbox.ts";

export interface PiInvocation {
  cwd: string;
  model: string;
  effortLevel: string;
  tools: string[];
  prompt: string;
  sessionDirectory: string;
  temporaryDirectory: string;
  writablePaths: string[];
}

export interface NullPiHarnessOutput {
  pid?: number;
  stdoutLines?: string[];
  stderr?: string;
  exitCode?: number;
}

export interface PiHarnessState {
  invocations: PiInvocation[];
  killed: boolean;
}

export interface PiHarnessProcess {
  pid: number;
  consumeLines(consume: (line: string) => Promise<void>): Promise<void>;
  stderr(): Promise<string>;
  exited(): Promise<number>;
  kill(): void;
}

interface PiProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

interface PiProcessDriver {
  spawn(command: string[], options: {
    cwd: string;
    stdin: "ignore";
    stdout: "pipe";
    stderr: "pipe";
    env: Record<string, string | undefined>;
  }): PiProcess;
}

interface PiPrivateConfigDriver {
  remove(path: string): Promise<void>;
}

/** INFRASTRUCTURE_WRAPPER: owns Pi process creation and its JSONL/stdout boundary. */
export class PiHarness {
  private readonly invocations: PiInvocation[] = [];
  private killed = false;

  constructor(
    private readonly driver: PiProcessDriver,
    private readonly sandbox: WorkerSandbox,
    private readonly privateConfig: PiPrivateConfigDriver,
  ) {}

  static create(): PiHarness {
    return new PiHarness(
      Bun as unknown as PiProcessDriver,
      WorkerSandbox.create(),
      { remove: async (path) => { await rm(path, { recursive: true, force: true }); } },
    );
  }

  static createNull(output: NullPiHarnessOutput = {}): PiHarness {
    return new PiHarness(
      {
        spawn: () => ({
          pid: output.pid ?? 1234,
          stdout: textStream(`${(output.stdoutLines ?? []).join("\n")}\n`),
          stderr: textStream(output.stderr ?? ""),
          exited: Promise.resolve(output.exitCode ?? 0),
          kill: () => {},
        }),
      },
      WorkerSandbox.createNull(),
      { remove: async () => {} },
    );
  }

  get state(): PiHarnessState {
    return { invocations: structuredClone(this.invocations), killed: this.killed };
  }

  async start(invocation: PiInvocation): Promise<PiHarnessProcess> {
    this.invocations.push(structuredClone(invocation));
    const privateConfigDirectory = join(invocation.temporaryDirectory, "agent");
    const command = await this.sandbox.wrap([
      "pi",
      "--mode", "json",
      "--print",
      "--tools", invocation.tools.join(","),
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-approve",
      "--session-dir", invocation.sessionDirectory,
      "--model", invocation.model,
      "--thinking", invocation.effortLevel,
      "--",
      invocation.prompt,
    ], {
      writablePaths: invocation.writablePaths,
      temporaryDirectory: invocation.temporaryDirectory,
    });

    let child: PiProcess;
    try {
      child = this.driver.spawn(command, {
        cwd: invocation.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...globalThis.process.env,
          TMPDIR: invocation.temporaryDirectory,
          PI_CODING_AGENT_DIR: privateConfigDirectory,
        },
      });
    } catch (error) {
      await this.sandbox.reset();
      await this.privateConfig.remove(privateConfigDirectory);
      throw error;
    }
    const exited = child.exited.then(async (exitCode) => {
      await this.sandbox.reset();
      await this.privateConfig.remove(privateConfigDirectory);
      return exitCode;
    });

    return {
      pid: child.pid,
      consumeLines: (consume) => consumeJsonLines(child.stdout, consume),
      stderr: () => new Response(child.stderr).text(),
      exited: () => exited,
      kill: () => {
        this.killed = true;
        child.kill();
      },
    };
  }
}

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function consumeJsonLines(
  stream: ReadableStream<Uint8Array>,
  consume: (line: string) => Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) await consume(line);
    if (done) break;
  }
  if (pending.trim()) await consume(pending);
}
