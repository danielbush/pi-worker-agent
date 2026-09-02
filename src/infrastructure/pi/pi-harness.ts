export interface PiInvocation {
  cwd: string;
  model: string;
  effortLevel: string;
  tools: string[];
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

interface PiProcessDriver {
  spawn(command: string[], options: {
    cwd: string;
    stdin: "ignore";
    stdout: "pipe";
    stderr: "pipe";
  }): PiProcess;
}

/** INFRASTRUCTURE_WRAPPER: owns Pi process creation and its JSONL/stdout boundary. */
export class PiHarness {
  private readonly invocations: PiInvocation[] = [];
  private killed = false;

  constructor(private readonly driver: PiProcessDriver) {}

  static create(): PiHarness {
    return new PiHarness(Bun as unknown as PiProcessDriver);
  }

  static createNull(output: NullPiHarnessOutput = {}): PiHarness {
    return new PiHarness({
      spawn: () => ({
        pid: output.pid ?? 1234,
        stdout: textStream(`${(output.stdoutLines ?? []).join("\n")}\n`),
        stderr: textStream(output.stderr ?? ""),
        exited: Promise.resolve(output.exitCode ?? 0),
        kill: () => {},
      }),
    });
  }

  get state(): PiHarnessState {
    return { invocations: structuredClone(this.invocations), killed: this.killed };
  }

  start(invocation: PiInvocation): PiHarnessProcess {
    this.invocations.push(structuredClone(invocation));
    const process = this.driver.spawn([
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
      cwd: invocation.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

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
