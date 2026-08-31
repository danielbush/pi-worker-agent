export interface PiInvocation {
  cwd: string;
  model: string;
  effortLevel: string;
  prompt: string;
  sessionDirectory: string;
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

/** INFRASTRUCTURE_WRAPPER: owns Pi process creation and its JSONL/stdout boundary. */
export class PiHarness {
  private readonly invocations: PiInvocation[] = [];
  private killed = false;

  private constructor(private readonly nullOutput: NullPiHarnessOutput | undefined) {}

  static create(): PiHarness {
    return new PiHarness(undefined);
  }

  static createNull(output: NullPiHarnessOutput = {}): PiHarness {
    return new PiHarness(output);
  }

  get state(): PiHarnessState {
    return { invocations: structuredClone(this.invocations), killed: this.killed };
  }

  start(invocation: PiInvocation): PiHarnessProcess {
    this.invocations.push(structuredClone(invocation));
    if (this.nullOutput) return this.startNull();

    const process = Bun.spawn([
      "pi",
      "--mode", "json",
      "--print",
      "--tools", "read,grep,find,ls",
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
      cwd: invocation.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }) as PiProcess;

    return {
      pid: process.pid,
      consumeLines: (consume) => consumeJsonLines(process.stdout, consume),
      stderr: () => new Response(process.stderr).text(),
      exited: () => process.exited,
      kill: () => {
        this.killed = true;
        process.kill();
      },
    };
  }

  private startNull(): PiHarnessProcess {
    const output = this.nullOutput!;
    return {
      pid: output.pid ?? 1234,
      consumeLines: async (consume) => {
        for (const line of output.stdoutLines ?? []) await consume(line);
      },
      stderr: async () => output.stderr ?? "",
      exited: async () => output.exitCode ?? 0,
      kill: () => { this.killed = true; },
    };
  }
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
