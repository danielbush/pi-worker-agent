import { capabilityForPurpose, profileFingerprint, type NativeInvocationSnapshot, type WorkerProfile } from "../domain/execution-profile.ts";
import { NativeHarness, type NullNativeHarnessOutput } from "../infrastructure/process/native-harness.ts";
import { normalizePiJsonLine, parsePiJsonLine } from "../harnesses/pi/pi-json-line.ts";
import { Registry, type NullRegistryState } from "../storage/registry.ts";
import { TaskStore, type NullTaskStoreState } from "../storage/task-store.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { HarnessSetup, toolsForCapability } from "../infrastructure/process/harness-setup.ts";
import { CursorStreamJsonNormalizer } from "../harnesses/cursor/cursor-stream-json.ts";
import { JobWorktreeLocator } from "../workflows/job-worktree-locator.ts";

export interface WorkerRunnerInput {
  taskId: string;
  jobId: string;
  workerSessionId: string;
}

export interface NullWorkerRunnerState {
  registry?: NullRegistryState;
  taskStore?: NullTaskStoreState;
  harness?: NullNativeHarnessOutput;
  timestamp?: string;
}

/** INFRASTRUCTURE_CONSUMER: runs one snapshotted harness adapter and projects canonical output. */
export class WorkerRunner {
  constructor(
    private readonly registry: Registry,
    private readonly taskStore: TaskStore,
    private readonly harness: NativeHarness,
    private readonly clock: Clock,
    private readonly setup: HarnessSetup = HarnessSetup.createNull(),
  ) {}

  static create(root: string): WorkerRunner {
    return new WorkerRunner(
      Registry.create(root),
      TaskStore.create(root),
      NativeHarness.create(),
      Clock.create(),
      HarnessSetup.create(),
    );
  }

  static createNull(state: NullWorkerRunnerState = {}): WorkerRunner {
    return new WorkerRunner(
      Registry.createNull(state.registry),
      TaskStore.createNull(state.taskStore),
      NativeHarness.createNull(state.harness),
      Clock.createNull(state.timestamp),
    );
  }

  close(): void {
    this.registry.close();
  }

  async execute(input: WorkerRunnerInput): Promise<number> {
    const job = this.registry.jobs.get(input.jobId);
    const task = this.registry.tasks.get(input.taskId);
    const workerSession = this.registry.workerSessions.get(input.workerSessionId);
    if (!job || job.taskId !== input.taskId) throw new Error(`Unknown job: ${input.jobId}`);
    if (!task) throw new Error(`Unknown task: ${input.taskId}`);
    if (!workerSession || workerSession.jobId !== job.id) {
      throw new Error(`Unknown worker session: ${input.workerSessionId}`);
    }
    const workspace = task.workspaceId ? this.registry.workspaces.get(task.workspaceId) : undefined;
    if (!workspace) throw new Error(`Task has no registered workspace: ${task.id}`);

    const events = this.taskStore.events(task.id, job.id, workerSession.id);
    const request = await this.taskStore.readRequest(task.id, job.id);
    let privateRuntimeDirectory: string | undefined;
    try {
      const snapshot = validateSnapshot(job);
      const capability = capabilityForPurpose(job.jobType);
      if (job.capabilityProfile !== capability) {
        throw new Error(`Capability snapshot mismatch for ${job.jobType}: expected ${capability}, found ${job.capabilityProfile}`);
      }
      const baseProfile: Omit<WorkerProfile, "fingerprint"> = {
        name: job.workerProfile!,
        harness: job.harness as WorkerProfile["harness"],
        model: job.model,
        options: job.harness === "pi" ? { thinking: job.effortLevel } : {} as Record<string, string>,
      };
      const fingerprint = profileFingerprint(baseProfile);
      if (fingerprint !== job.profileFingerprint) throw new Error(`Worker profile fingerprint mismatch for job ${job.id}`);
      const profile: WorkerProfile = { ...baseProfile, fingerprint };
      const verified = this.setup.verify(profile, capability, workspace.rootDir);
      if (verified.version !== job.harnessVersion || JSON.stringify(verified.invocation) !== JSON.stringify(snapshot)) {
        throw new Error(`Harness contract changed since job ${job.id} was snapshotted; refusing to launch`);
      }
      const sessionDirectory = await this.taskStore.prepareHarnessSessionDirectory(workerSession.storagePath);
      privateRuntimeDirectory = await this.taskStore.createPrivateRuntimeDirectory();
      this.registry.transaction(() => {
        this.registry.tasks.updateStatus(task.id, "running");
        this.registry.jobs.updateStatus(job.id, "running", `${job.harness} ${job.jobType} worker is running`);
      });

      const requiresWorktree = ["implement", "review", "fix", "test"].includes(job.jobType);
      const worktreePath = requiresWorktree ? new JobWorktreeLocator(this.registry, this.taskStore).locate(job) : null;
      if (requiresWorktree && !worktreePath) {
        throw new Error(`${job.jobType} job has no implementation worktree: ${job.id}`);
      }
      const cwd = worktreePath ?? workspace.rootDir;
      const temporaryDirectory = privateRuntimeDirectory;
      const process = await this.harness.start({
        cwd,
        model: job.model,
        effortLevel: job.effortLevel,
        tools: toolsForCapability(capability),
        prompt: request,
        sessionDirectory,
        temporaryDirectory,
        harness: job.harness as WorkerProfile["harness"],
        nativeInvocation: snapshot,
        writablePaths: [
          sessionDirectory,
          temporaryDirectory,
          ...(capability === "code" ? [cwd] : []),
        ],
      });
      await events.append({ timestamp: this.clock.now(), type: "session.started", pid: process.pid });
      await events.append({ timestamp: this.clock.now(), type: "prompt", text: request });

      const stderrPromise = process.stderr();
      let agentSettled = false;
      let assistantCompleted = false;
      let cursorTerminalSuccess = false;
      const cursor = new CursorStreamJsonNormalizer();
      let assistantResult: string | undefined;
      let assistantFailure: string | undefined;
      try {
        await process.consumeLines(async (line) => {
          const normalized = job.harness === "cursor-agent"
            ? cursor.consume(line, this.clock.now())
            : normalizePiJsonLine(parsePiJsonLine(line), this.clock.now());
          if (normalized.harnessSessionId) {
            this.registry.workerSessions.setHarnessSession(workerSession.id, normalized.harnessSessionId, null);
          }
          if ("terminal" in normalized && normalized.terminal) {
            agentSettled = true;
            assistantCompleted = normalized.events.some((event) => event.type === "assistant.completed");
            cursorTerminalSuccess = normalized.success === true;
            if (normalized.failure) assistantFailure = normalized.failure;
          }
          if ("agentSettled" in normalized && normalized.agentSettled) agentSettled = true;
          if ("assistantCompleted" in normalized && normalized.assistantCompleted) {
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
        && (job.harness !== "cursor-agent" || cursorTerminalSuccess)
        && !assistantFailure
        && !reportedFailure;
      if (succeeded) {
        this.registry.jobs.updateStatus(job.id, "completed", `${job.jobType} completed`, finishedAt);
        return 0;
      }

      const detail = assistantFailure ?? reportedFailure ?? (
        stderr.trim()
        || (exitCode !== 0
          ? `${job.harness} exited with code ${exitCode}`
          : agentSettled
          ? `${job.harness} settled without a completed assistant message`
          : `${job.harness} exited before the agent settled`)
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
    } finally {
      if (privateRuntimeDirectory) await this.taskStore.removePrivateRuntimeDirectory(privateRuntimeDirectory);
    }
  }
}

export { toolsForCapability };
export function toolsForJob(jobType: string): string[] {
  return toolsForCapability(jobType === "implement" || jobType === "fix" ? "code" : jobType === "test" ? "test" : "read-only");
}

function validateSnapshot(job: import("../domain/job.ts").Job): NativeInvocationSnapshot {
  if (job.snapshotProvenance !== "current") {
    throw new Error(`Job ${job.id} is not a current execution snapshot and cannot be launched`);
  }
  if (!job.workerProfile || !job.profileFingerprint || !job.capabilityProfile || !job.harnessVersion || !job.nativeInvocation) {
    throw new Error(`Job ${job.id} has an incomplete current execution snapshot and cannot be launched`);
  }
  if (!["pi", "cursor-agent"].includes(job.harness)) throw new Error(`Unknown snapshotted harness: ${job.harness}`);
  if (!["read-only", "code", "test"].includes(job.capabilityProfile)) throw new Error(`Unknown capability snapshot: ${job.capabilityProfile}`);
  let value: unknown;
  try { value = JSON.parse(job.nativeInvocation); } catch { throw new Error(`Invalid native invocation snapshot for job ${job.id}`); }
  const invocation = value as { executable?: unknown; args?: unknown };
  if (!invocation || Object.keys(invocation).sort().join(",") !== "args,executable" || typeof invocation.executable !== "string" || !invocation.executable.startsWith("/") || !Array.isArray(invocation.args) || !invocation.args.every((item) => typeof item === "string")) {
    throw new Error(`Invalid native invocation snapshot for job ${job.id}`);
  }
  return invocation as NativeInvocationSnapshot;
}

export function reportedWorkerFailure(result: string | undefined): string | undefined {
  if (!result) return undefined;
  const firstLine = result.trim().split("\n", 1)[0] ?? "";
  return /^(unable to|failed to|i (?:cannot|can't|could not|couldn't)\b)/i.test(firstLine)
    ? firstLine
    : undefined;
}
