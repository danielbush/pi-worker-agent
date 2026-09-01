import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_ROOT } from "../config.ts";
import { GreetingProjectFixture } from "../demo/greeting-project-fixture.ts";
import { Id } from "../domain/id.ts";
import {
  DetachedRunnerLauncher,
  type DetachedRunnerLaunch,
} from "../infrastructure/process/detached-runner-launcher.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { WorkerDemoPlanningJobCreator } from "../workflows/worker-demo-planning-job-creator.ts";
import { WorkerDemoTaskCreator } from "../workflows/worker-demo-task-creator.ts";
import { WorkerCompletionMonitor } from "./worker-completion-monitor.ts";
import { formatWorkerStatus, WorkerStatusReporter } from "./worker-status-reporter.ts";

type WorkerAgentPi = Pick<ExtensionAPI, "on" | "registerCommand" | "sendMessage">;

interface WorkerAgentServices {
  registry(): Registry;
  taskStore(): TaskStore;
  greetingProject(examplesRoot: string): GreetingProjectFixture;
}

export interface WorkerAgentExtensionState {
  registered: boolean;
  launches: DetachedRunnerLaunch[];
}

export interface NullWorkerAgentExtensionState {
  root?: string;
  registry?: Parameters<typeof Registry.createNull>[0];
  taskStore?: Parameters<typeof TaskStore.createNull>[0];
  baselineCommit?: string;
  runnerPid?: number;
}

/** INFRASTRUCTURE_WRAPPER: owns Pi registration and worker-agent service lifecycle. */
export class WorkerAgentExtension {
  private registry: Registry | undefined;
  private completionMonitor: WorkerCompletionMonitor | undefined;
  private lastTaskId: string | undefined;
  private registered = false;

  constructor(
    private readonly pi: WorkerAgentPi,
    private readonly root: string,
    private readonly runner: DetachedRunnerLauncher,
    private readonly services: WorkerAgentServices,
  ) {}

  static create(pi: ExtensionAPI): WorkerAgentExtension {
    const root = DATA_ROOT;
    return new WorkerAgentExtension(
      pi,
      root,
      DetachedRunnerLauncher.create(fileURLToPath(new URL("../runner/main.ts", import.meta.url))),
      {
        registry: () => Registry.create(root),
        taskStore: () => TaskStore.create(root),
        greetingProject: (examplesRoot) => GreetingProjectFixture.create(examplesRoot),
      },
    );
  }

  static createNull(state: NullWorkerAgentExtensionState = {}): WorkerAgentExtension {
    const root = state.root ?? "/null-worker-agent";
    const pi = {
      on: () => {},
      registerCommand: () => {},
      sendMessage: () => {},
    } as unknown as WorkerAgentPi;
    return new WorkerAgentExtension(
      pi,
      root,
      DetachedRunnerLauncher.createNull(undefined, state.runnerPid),
      {
        registry: () => Registry.createNull(state.registry),
        taskStore: () => TaskStore.createNull(state.taskStore),
        greetingProject: (examplesRoot) => GreetingProjectFixture.createNull(examplesRoot, state.baselineCommit),
      },
    );
  }

  get state(): WorkerAgentExtensionState {
    return { registered: this.registered, launches: this.runner.state };
  }

  register(): void {
    this.registered = true;
    this.pi.on("session_start", async (_event, ctx) => {
      const registry = this.registry ??= this.services.registry();
      this.completionMonitor?.stop();
      this.completionMonitor = WorkerCompletionMonitor.create(
        registry,
        this.services.taskStore(),
        (message, level) => ctx.ui.notify(message, level),
        (message) => this.pi.sendMessage({
          customType: "worker-agent-result",
          content: message,
          display: false,
        }, {
          triggerTurn: false,
          deliverAs: "followUp",
        }),
      );
      this.completionMonitor.start(ctx.sessionManager.getSessionId());
    });

    this.pi.on("session_shutdown", async () => {
      this.completionMonitor?.stop();
      this.completionMonitor = undefined;
      this.registry?.close();
      this.registry = undefined;
    });

    this.pi.registerCommand("worker-status", {
      description: "Show task, job, worker-session, and result status",
      handler: async (args, ctx) => {
        const taskId = args.trim().split(/\s+/)[0] || this.lastTaskId;
        if (!taskId) {
          ctx.ui.notify("No worker tasks have been started in this session.", "info");
          return;
        }
        try {
          const registry = this.registry ??= this.services.registry();
          const status = await WorkerStatusReporter.create(
            registry,
            this.services.taskStore(),
          ).inspect(taskId);
          if (!status) {
            ctx.ui.notify(`Unknown worker task: ${taskId}`, "error");
            return;
          }
          ctx.ui.notify(formatWorkerStatus(status), "info");
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Unable to read worker status: ${detail}`, "error");
        }
      },
    });

    this.pi.registerCommand("worker-demo", {
      description: "Run the hardcoded Pi/Pi worker demonstration",
      handler: async (_args, ctx) => {
        const model = ctx.model;
        if (!model) {
          ctx.ui.notify("Cannot start worker demo without an active model.", "error");
          return;
        }

        try {
          const registry = this.registry ??= this.services.registry();
          const taskStore = this.services.taskStore();
          const ids = Id.create();
          const demo = await WorkerDemoTaskCreator.create(
            this.services.greetingProject(join(ctx.cwd, ".examples")),
            taskStore,
            registry,
            ids,
          ).create();
          this.lastTaskId = demo.task.id;
          const planning = await WorkerDemoPlanningJobCreator.create(taskStore, registry, ids).create(demo, {
            parentSessionId: ctx.sessionManager.getSessionId(),
            parentSessionFile: ctx.sessionManager.getSessionFile() ?? null,
            model: `${model.provider}/${model.id}`,
            modelName: model.name,
            modelVersion: model.id,
            effortLevel: ctx.thinkingLevel ?? "medium",
          });
          const pid = this.runner.launch(this.root, demo.task.id, planning.job.id, planning.workerSession.id);
          ctx.ui.notify(`Started planning worker ${planning.job.id} (pid ${pid}) for task ${demo.task.id}.`, "info");
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Unable to start worker demo: ${detail}`, "error");
        }
      },
    });
  }
}
