import type { Id } from "../domain/id.ts";
import type { Job } from "../domain/job.ts";
import type { WorkerSession } from "../domain/worker-session.ts";
import type { Registry } from "../storage/registry.ts";
import type { TaskStore } from "../storage/task-store.ts";
import {
  DEMO_BACKGROUND,
  DEMO_INTENT,
  DEMO_OUTCOMES,
  type CreatedWorkerDemoTask,
} from "./worker-demo-task-creator.ts";

export interface PlanningWorkerConfiguration {
  parentSessionId: string;
  parentSessionFile: string | null;
  model: string;
  modelName: string;
  modelVersion: string;
  effortLevel: string;
}

export interface CreatedWorkerDemoPlanningJob {
  job: Job;
  workerSession: WorkerSession;
}

/** Creates the real planning job and worker session for `/worker-demo`. */
export class WorkerDemoPlanningJobCreator {
  constructor(
    private readonly taskStore: TaskStore,
    private readonly registry: Registry,
    private readonly ids: Pick<Id, "createJobId" | "createWorkerSessionId">,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async create(
    demo: CreatedWorkerDemoTask,
    worker: PlanningWorkerConfiguration,
  ): Promise<CreatedWorkerDemoPlanningJob> {
    const jobId = this.ids.createJobId();
    const workerSessionId = this.ids.createWorkerSessionId();
    const timestamp = this.now();
    const bundlePath = await this.taskStore.jobs.create({
      taskId: demo.task.id,
      jobId,
      request: planningRequest(demo.fixture.rootDir),
    });
    const eventLog = this.taskStore.events(demo.task.id, jobId, workerSessionId);
    await eventLog.create();

    const job: Job = {
      id: jobId,
      taskId: demo.task.id,
      jobType: "plan",
      parentSessionId: worker.parentSessionId,
      parentSessionFile: worker.parentSessionFile,
      harness: "pi",
      model: worker.model,
      effortLevel: worker.effortLevel,
      modelName: worker.modelName,
      modelVersion: worker.modelVersion,
      title: "Plan greeting CLI implementation",
      status: "queued",
      progress: "Waiting to start Pi planning worker",
      createdAt: timestamp,
      finishedAt: null,
      bundlePath,
      userNotified: false,
      agentNotified: false,
    };
    const workerSession: WorkerSession = {
      id: workerSessionId,
      jobId,
      harnessSessionId: null,
      harnessSessionPath: null,
      storagePath: this.taskStore.paths.workerSession(demo.task.id, jobId, workerSessionId),
      createdAt: timestamp,
    };

    this.registry.transaction(() => {
      this.registry.jobs.create(job);
      this.registry.workerSessions.create(workerSession);
    });
    return { job, workerSession };
  }
}

function planningRequest(projectRoot: string): string {
  return [
    "# Planning request",
    "",
    "Inspect the project using read-only tools and produce a concise implementation plan.",
    "Do not modify files. Identify the files to change, expected behavior, and tests to run.",
    "",
    `Project root: ${projectRoot}`,
    "",
    "## Intent",
    "",
    DEMO_INTENT.trim(),
    "",
    DEMO_OUTCOMES.trim(),
    "",
    DEMO_BACKGROUND.trim(),
    "",
  ].join("\n");
}
