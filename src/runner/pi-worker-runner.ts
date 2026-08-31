import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { normalizePiJsonLine, parsePiJsonLine } from "../harnesses/pi/pi-json-line.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";

export interface PiProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

export interface PiInvocation {
  cwd: string;
  model: string;
  effortLevel: string;
  prompt: string;
  sessionDirectory: string;
}

export type SpawnPi = (invocation: PiInvocation) => PiProcess;

export interface PiWorkerRunnerInput {
  taskId: string;
  jobId: string;
  workerSessionId: string;
}

/** Owns one real Pi worker process and projects its output into storage. */
export class PiWorkerRunner {
  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly spawnPi: SpawnPi = spawnPiProcess,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async execute(input: PiWorkerRunnerInput): Promise<number> {
    const job = this.registry.jobs.get(input.jobId);
    const task = this.registry.tasks.get(input.taskId);
    const workerSession = this.registry.workerSessions.get(input.workerSessionId);
    if (!job || job.taskId !== input.taskId) throw new Error(`Unknown job: ${input.jobId}`);
    if (!task) throw new Error(`Unknown task: ${input.taskId}`);
    if (!workerSession || workerSession.jobId !== job.id) {
      throw new Error(`Unknown worker session: ${input.workerSessionId}`);
    }
    const project = task.projectId ? this.registry.projects.get(task.projectId) : undefined;
    if (!project) throw new Error(`Task has no registered project: ${task.id}`);

    const events = this.taskStore.events(task.id, job.id, workerSession.id);
    const request = await Bun.file(this.taskStore.paths.request(task.id, job.id)).text();
    const sessionDirectory = join(workerSession.storagePath, "pi-session");
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    this.registry.transaction(() => {
      this.registry.tasks.updateStatus(task.id, "running");
      this.registry.jobs.updateStatus(job.id, "running", "Pi planning worker is running");
    });

    try {
      const process = this.spawnPi({
        cwd: project.rootDir,
        model: job.model,
        effortLevel: job.effortLevel,
        prompt: request,
        sessionDirectory,
      });
      await events.append({ timestamp: this.now(), type: "session.started", pid: process.pid });
      await events.append({ timestamp: this.now(), type: "prompt", text: request });

      const stderrPromise = new Response(process.stderr).text();
      let agentSettled = false;
      let assistantCompleted = false;
      let assistantFailure: string | undefined;
      try {
        await consumeJsonLines(process.stdout, async (line) => {
          const normalized = normalizePiJsonLine(parsePiJsonLine(line), this.now());
          if (normalized.harnessSessionId) {
            this.registry.workerSessions.setHarnessSession(workerSession.id, normalized.harnessSessionId, null);
          }
          if (normalized.agentSettled) agentSettled = true;
          if (normalized.assistantCompleted) {
            assistantCompleted = true;
            assistantFailure = normalized.assistantFailure;
          }
          for (const event of normalized.events) await events.append(event);
        });
      } catch (error) {
        process.kill();
        const exitCode = await process.exited;
        await stderrPromise;
        await events.append({ timestamp: this.now(), type: "session.completed", exitCode });
        throw error;
      }

      const [exitCode, stderr] = await Promise.all([process.exited, stderrPromise]);
      await events.append({ timestamp: this.now(), type: "session.completed", exitCode });
      const harnessSessionId = this.registry.workerSessions.get(workerSession.id)?.harnessSessionId;
      if (harnessSessionId) {
        this.registry.workerSessions.setHarnessSession(
          workerSession.id,
          harnessSessionId,
          await findHarnessSessionPath(sessionDirectory, harnessSessionId),
        );
      }

      const finishedAt = this.now();
      const succeeded = exitCode === 0 && agentSettled && assistantCompleted && !assistantFailure;
      if (succeeded) {
        this.registry.jobs.updateStatus(job.id, "completed", "Planning completed", finishedAt);
        return 0;
      }

      const detail = assistantFailure ?? (
        stderr.trim()
        || (exitCode !== 0
          ? `Pi exited with code ${exitCode}`
          : agentSettled
          ? "Pi settled without a completed assistant message"
          : "Pi exited before the agent settled")
      );
      if (!assistantFailure) {
        await events.append({ timestamp: finishedAt, type: "error", error: detail });
      }
      this.registry.transaction(() => {
        this.registry.jobs.updateStatus(job.id, "failed", detail, finishedAt);
        this.registry.tasks.updateStatus(task.id, "failed", finishedAt);
      });
      return exitCode || 1;
    } catch (error) {
      const finishedAt = this.now();
      const detail = error instanceof Error ? error.message : String(error);
      await events.append({ timestamp: finishedAt, type: "error", error: detail });
      this.registry.transaction(() => {
        this.registry.jobs.updateStatus(job.id, "failed", detail, finishedAt);
        this.registry.tasks.updateStatus(task.id, "failed", finishedAt);
      });
      return 1;
    }
  }
}

export function spawnPiProcess(invocation: PiInvocation): PiProcess {
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
  });
  return process as PiProcess;
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

async function findHarnessSessionPath(directory: string, sessionId: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sessionFile = entries.find((entry) => entry.isFile() && entry.name.includes(sessionId));
  return sessionFile ? join(directory, sessionFile.name) : null;
}
