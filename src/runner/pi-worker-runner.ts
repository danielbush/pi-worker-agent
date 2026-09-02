import type { JobType } from "../domain/job.ts";
import { PiHarness, type NullPiHarnessOutput } from "../infrastructure/pi/pi-harness.ts";
import { normalizePiJsonLine, parsePiJsonLine } from "../harnesses/pi/pi-json-line.ts";
import { Registry, type NullRegistryState } from "../storage/registry.ts";
import { TaskStore, type NullTaskStoreState } from "../storage/task-store.ts";
import { Clock } from "../infrastructure/system/clock.ts";

export interface PiWorkerRunnerInput {
  taskId: string;
  jobId: string;
  workerSessionId: string;
}

export interface NullPiWorkerRunnerState {
  registry?: NullRegistryState;
  taskStore?: NullTaskStoreState;
  harness?: NullPiHarnessOutput;
  timestamp?: string;
}

/** INFRASTRUCTURE_CONSUMER: runs one Pi worker and projects its output into storage. */
export class PiWorkerRunner {
  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly harness: PiHarness,
    private readonly clock: Clock,
  ) {}

  static create(root: string): PiWorkerRunner {
    return new PiWorkerRunner(
      Registry.create(root),
      TaskStore.create(root),
      PiHarness.create(),
      Clock.create(),
    );
  }

  static createNull(state: NullPiWorkerRunnerState = {}): PiWorkerRunner {
    return new PiWorkerRunner(
      Registry.createNull(state.registry),
      TaskStore.createNull(state.taskStore),
      PiHarness.createNull(state.harness),
      Clock.createNull(state.timestamp),
    );
  }

  close(): void {
    this.registry.close();
  }

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
    const request = await this.taskStore.readRequest(task.id, job.id);
    const sessionDirectory = await this.taskStore.prepareHarnessSessionDirectory(workerSession.storagePath);
    this.registry.transaction(() => {
      this.registry.tasks.updateStatus(task.id, "running");
      this.registry.jobs.updateStatus(job.id, "running", `Pi ${job.jobType} worker is running`);
    });

    try {
      const process = this.harness.start({
        cwd: job.jobType === "implement" ? this.taskStore.paths.worktree(job.id) : project.rootDir,
        model: job.model,
        effortLevel: job.effortLevel,
        tools: toolsForJob(job.jobType),
        prompt: request,
        sessionDirectory,
      });
      await events.append({ timestamp: this.clock.now(), type: "session.started", pid: process.pid });
      await events.append({ timestamp: this.clock.now(), type: "prompt", text: request });

      const stderrPromise = process.stderr();
      let agentSettled = false;
      let assistantCompleted = false;
      let assistantResult: string | undefined;
      let assistantFailure: string | undefined;
      try {
        await process.consumeLines(async (line) => {
          const normalized = normalizePiJsonLine(parsePiJsonLine(line), this.clock.now());
          if (normalized.harnessSessionId) {
            this.registry.workerSessions.setHarnessSession(workerSession.id, normalized.harnessSessionId, null);
          }
          if (normalized.agentSettled) agentSettled = true;
          if (normalized.assistantCompleted) {
            assistantCompleted = true;
            assistantFailure = normalized.assistantFailure;
          }
          for (const event of normalized.events) {
            if (event.type === "assistant.completed") assistantResult = event.text;
            await events.append(event);
          }
        });
      } catch (error) {
        process.kill();
        const exitCode = await process.exited();
        await stderrPromise;
        await events.append({ timestamp: this.clock.now(), type: "session.completed", exitCode });
        throw error;
      }

      const [exitCode, stderr] = await Promise.all([process.exited(), stderrPromise]);
      await events.append({ timestamp: this.clock.now(), type: "session.completed", exitCode });
      const harnessSessionId = this.registry.workerSessions.get(workerSession.id)?.harnessSessionId;
      if (harnessSessionId) {
        this.registry.workerSessions.setHarnessSession(
          workerSession.id,
          harnessSessionId,
          await this.taskStore.findHarnessSessionPath(sessionDirectory, harnessSessionId),
        );
      }

      const finishedAt = this.clock.now();
      const reportedFailure = reportedWorkerFailure(assistantResult);
      const succeeded = exitCode === 0
        && agentSettled
        && assistantCompleted
        && !assistantFailure
        && !reportedFailure;
      if (succeeded) {
        this.registry.jobs.updateStatus(job.id, "completed", `${job.jobType} completed`, finishedAt);
        return 0;
      }

      const detail = assistantFailure ?? reportedFailure ?? (
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
      const finishedAt = this.clock.now();
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

export function toolsForJob(jobType: JobType): string[] {
  const readOnly = ["read", "grep", "find", "ls"];
  if (jobType === "implement" || jobType === "fix") {
    return [...readOnly, "write", "edit", "bash"];
  }
  if (jobType === "test") return [...readOnly, "bash"];
  return readOnly;
}

export function reportedWorkerFailure(result: string | undefined): string | undefined {
  if (!result) return undefined;
  const firstLine = result.trim().split("\n", 1)[0] ?? "";
  return /^(unable to|failed to|i (?:cannot|can't|could not|couldn't)\b)/i.test(firstLine)
    ? firstLine
    : undefined;
}
