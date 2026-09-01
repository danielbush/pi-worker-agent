import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DATA_ROOT } from "../config.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { WorkerCompletionMonitor } from "./worker-completion-monitor.ts";
import { formatWorkerStatus, WorkerStatusReporter } from "./worker-status-reporter.ts";

type WorkerAgentPi = Pick<ExtensionAPI, "on" | "registerCommand" | "sendMessage">;

interface WorkerAgentServices {
  registry(): Registry;
  taskStore(): TaskStore;
}

export interface WorkerAgentExtensionState {
  registered: boolean;
}

export interface NullWorkerAgentExtensionState {
  registry?: Parameters<typeof Registry.createNull>[0];
  taskStore?: Parameters<typeof TaskStore.createNull>[0];
}

/** INFRASTRUCTURE_WRAPPER: owns Pi registration and worker-agent service lifecycle. */
export class WorkerAgentExtension {
  private registry: Registry | undefined;
  private completionMonitor: WorkerCompletionMonitor | undefined;
  private registered = false;

  constructor(
    private readonly pi: WorkerAgentPi,
    private readonly services: WorkerAgentServices,
  ) {}

  static create(pi: ExtensionAPI): WorkerAgentExtension {
    return new WorkerAgentExtension(pi, {
      registry: () => Registry.create(DATA_ROOT),
      taskStore: () => TaskStore.create(DATA_ROOT),
    });
  }

  static createNull(state: NullWorkerAgentExtensionState = {}): WorkerAgentExtension {
    const pi = {
      on: () => {},
      registerCommand: () => {},
      sendMessage: () => {},
    } as unknown as WorkerAgentPi;
    return new WorkerAgentExtension(pi, {
      registry: () => Registry.createNull(state.registry),
      taskStore: () => TaskStore.createNull(state.taskStore),
    });
  }

  get state(): WorkerAgentExtensionState {
    return { registered: this.registered };
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
        const taskId = args.trim().split(/\s+/)[0];
        if (!taskId) {
          ctx.ui.notify("Pass a task UUID: /worker-status <task-uuid>", "info");
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
  }
}
