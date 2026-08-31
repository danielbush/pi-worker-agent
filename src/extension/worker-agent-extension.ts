import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GreetingProjectFixture } from "../demo/greeting-project-fixture.ts";
import { Id } from "../domain/id.ts";
import { DetachedRunnerLauncher } from "../infrastructure/process/detached-runner-launcher.ts";
import { getDataRoot } from "../storage/paths.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { WorkerDemoPlanningJobCreator } from "../workflows/worker-demo-planning-job-creator.ts";
import { WorkerDemoTaskCreator } from "../workflows/worker-demo-task-creator.ts";
import { WorkerCompletionMonitor } from "./worker-completion-monitor.ts";

/** INFRASTRUCTURE_WRAPPER: owns Pi registration and worker-agent service lifecycle. */
export class WorkerAgentExtension {
  private readonly root = getDataRoot();
  private readonly runner = new DetachedRunnerLauncher(
    fileURLToPath(new URL("../runner/main.ts", import.meta.url)),
  );
  private registry: Registry | undefined;
  private completionMonitor: WorkerCompletionMonitor | undefined;

  constructor(private readonly pi: ExtensionAPI) {}

  register(): void {
    this.pi.on("session_start", async (_event, ctx) => {
      const registry = this.registry ??= new Registry(this.root);
      this.completionMonitor?.stop();
      this.completionMonitor = new WorkerCompletionMonitor(
        registry,
        TaskStore.create(this.root),
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

    this.pi.registerCommand("worker-demo", {
      description: "Run the hardcoded Pi/Pi worker demonstration",
      handler: async (_args, ctx) => {
        const model = ctx.model;
        if (!model) {
          ctx.ui.notify("Cannot start worker demo without an active model.", "error");
          return;
        }

        try {
          const registry = this.registry ??= new Registry(this.root);
          const taskStore = TaskStore.create(this.root);
          const ids = Id.create();
          const demo = await new WorkerDemoTaskCreator(
            GreetingProjectFixture.create(join(ctx.cwd, ".examples")),
            taskStore,
            registry,
            ids,
          ).create();
          const planning = await new WorkerDemoPlanningJobCreator(
            taskStore,
            registry,
            ids,
          ).create(demo, {
            parentSessionId: ctx.sessionManager.getSessionId(),
            parentSessionFile: ctx.sessionManager.getSessionFile() ?? null,
            model: `${model.provider}/${model.id}`,
            modelName: model.name,
            modelVersion: model.id,
            effortLevel: ctx.thinkingLevel ?? "medium",
          });
          const pid = this.runner.launch(
            this.root,
            demo.task.id,
            planning.job.id,
            planning.workerSession.id,
          );
          ctx.ui.notify(
            `Started planning worker ${planning.job.id} (pid ${pid}) for task ${demo.task.id}.`,
            "info",
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Unable to start worker demo: ${detail}`, "error");
        }
      },
    });
  }
}
