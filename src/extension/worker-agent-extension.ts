import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { DATA_ROOT } from "../config.ts";
import { Id } from "../domain/id.ts";
import { JOB_TYPES, type JobType } from "../domain/job.ts";
import {
  DetachedRunnerLauncher,
  type DetachedRunnerLaunch,
} from "../infrastructure/process/detached-runner-launcher.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { JobDelegator } from "../workflows/job-delegator.ts";
import { TaskCreator } from "../workflows/task-creator.ts";
import { ManagerPermissions } from "./manager-permissions.ts";
import { WorkerCompletionMonitor } from "./worker-completion-monitor.ts";
import { formatWorkerStatus, WorkerStatusReporter } from "./worker-status-reporter.ts";

type WorkerAgentPi = Pick<
  ExtensionAPI,
  "getActiveTools" | "on" | "registerCommand" | "registerTool" | "sendMessage" | "setActiveTools"
>;

interface WorkerAgentServices {
  registry(): Registry;
  taskStore(): TaskStore;
}

export interface WorkerAgentExtensionState {
  registered: boolean;
  launches: DetachedRunnerLaunch[];
}

export interface NullWorkerAgentExtensionState {
  root?: string;
  registry?: Parameters<typeof Registry.createNull>[0];
  taskStore?: Parameters<typeof TaskStore.createNull>[0];
  runnerPid?: number;
}

/** INFRASTRUCTURE_WRAPPER: owns Pi registration and worker-agent service lifecycle. */
export class WorkerAgentExtension {
  private registry: Registry | undefined;
  private completionMonitor: WorkerCompletionMonitor | undefined;
  private registered = false;

  constructor(
    private readonly pi: WorkerAgentPi,
    private readonly root: string,
    private readonly runner: DetachedRunnerLauncher,
    private readonly services: WorkerAgentServices,
  ) {}

  static create(pi: ExtensionAPI): WorkerAgentExtension {
    return new WorkerAgentExtension(
      pi,
      DATA_ROOT,
      DetachedRunnerLauncher.create(fileURLToPath(new URL("../runner/main.ts", import.meta.url))),
      {
        registry: () => Registry.create(DATA_ROOT),
        taskStore: () => TaskStore.create(DATA_ROOT),
      },
    );
  }

  static createNull(state: NullWorkerAgentExtensionState = {}): WorkerAgentExtension {
    const pi = {
      getActiveTools: () => [],
      on: () => {},
      registerCommand: () => {},
      registerTool: () => {},
      sendMessage: () => {},
      setActiveTools: () => {},
    } as unknown as WorkerAgentPi;
    return new WorkerAgentExtension(
      pi,
      state.root ?? "/null-worker-agent",
      DetachedRunnerLauncher.createNull(undefined, state.runnerPid),
      {
        registry: () => Registry.createNull(state.registry),
        taskStore: () => TaskStore.createNull(state.taskStore),
      },
    );
  }

  get state(): WorkerAgentExtensionState {
    return { registered: this.registered, launches: this.runner.state };
  }

  register(): void {
    this.registered = true;
    this.registerLifecycle();
    this.registerTaskTool();
    this.registerJobTool();
    this.registerStatusCommand();
    new ManagerPermissions(this.pi).register();
  }

  private registerLifecycle(): void {
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
  }

  private registerTaskTool(): void {
    this.pi.registerTool({
      name: "worker_create_task",
      label: "Create worker task",
      description: "Create a durable task with canonical intent, outcomes, and background against a registered workspace.",
      promptSnippet: "Create a durable worker task against a workspace",
      promptGuidelines: [
        "Use worker_create_task instead of temporary scripts, direct SQLite writes, or manual task-directory creation.",
        "After worker_create_task succeeds, reference its UUID from the managed-project slice and .agent/tasks.md.",
      ],
      parameters: Type.Object({
        title: Type.String(),
        intent: Type.Optional(Type.String()),
        outcomes: Type.Optional(Type.String()),
        background: Type.String(),
        workspaceRoot: Type.Optional(Type.String({ description: "Defaults to the current Pi working directory" })),
        workspaceName: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const root = canonicalWorkspace(params.workspaceRoot ?? ctx.cwd, "Requested workspace");
        const currentWorkspace = canonicalWorkspace(ctx.cwd, "Current Pi workspace");
        if (root !== currentWorkspace) {
          throw new Error("Manager mode can create tasks only for the current Pi workspace");
        }
        const registry = this.registry ??= this.services.registry();
        const created = await TaskCreator.create(
          registry,
          this.services.taskStore(),
          Id.create(),
        ).create({
          workspaceRoot: root,
          workspaceName: params.workspaceName ?? basename(root),
          title: params.title,
          intent: params.intent,
          outcomes: params.outcomes,
          background: params.background,
        });
        return {
          content: [{
            type: "text",
            text: `Created task ${created.task.id} for workspace ${created.project.name}.`,
          }],
          details: { taskId: created.task.id, projectId: created.project.id },
        };
      },
    });
  }

  private registerJobTool(): void {
    this.pi.registerTool({
      name: "worker_delegate_job",
      label: "Delegate worker job",
      description: "Create and launch the next plan or implement job for an existing task. Implement jobs receive an isolated git worktree and write/edit/bash tools.",
      promptSnippet: "Create and launch a plan or implement worker job",
      promptGuidelines: [
        "Use worker_delegate_job instead of temporary scripts, direct SQLite writes, manual worktree creation, or direct runner invocation.",
        "Evaluate a completed dependency before calling worker_delegate_job for the next workflow transition.",
      ],
      parameters: Type.Object({
        taskId: Type.String(),
        jobType: Type.String({ description: "plan or implement" }),
        title: Type.String(),
        request: Type.String({ description: "Complete canonical worker prompt, including relevant task context and accepted dependency results" }),
        dependsOnJobId: Type.Optional(Type.String()),
        relationship: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        if (!JOB_TYPES.includes(params.jobType as JobType)) {
          throw new Error(`Unknown job type: ${params.jobType}`);
        }
        const model = ctx.model;
        if (!model) throw new Error("Cannot delegate without an active model");
        const registry = this.registry ??= this.services.registry();
        const task = registry.tasks.get(params.taskId);
        const project = task?.projectId ? registry.projects.get(task.projectId) : undefined;
        if (!project) throw new Error(`Task has no registered workspace: ${params.taskId}`);
        const projectRoot = canonicalWorkspace(project.rootDir, "Task workspace");
        const currentWorkspace = canonicalWorkspace(ctx.cwd, "Current Pi workspace");
        if (projectRoot !== currentWorkspace) {
          throw new Error("Manager mode can delegate jobs only for the current Pi workspace");
        }
        const delegated = await JobDelegator.create(
          this.root,
          registry,
          this.services.taskStore(),
          Id.create(),
          this.runner,
        ).delegate({
          taskId: params.taskId,
          jobType: params.jobType as JobType,
          title: params.title,
          request: params.request,
          dependsOnJobId: params.dependsOnJobId,
          relationship: params.relationship,
          parentSessionId: ctx.sessionManager.getSessionId(),
          parentSessionFile: ctx.sessionManager.getSessionFile() ?? null,
          model: `${model.provider}/${model.id}`,
          modelName: model.name,
          modelVersion: model.id,
          effortLevel: ctx.thinkingLevel ?? "medium",
        });
        return {
          content: [{
            type: "text",
            text: [
              `Started ${delegated.job.jobType} job ${delegated.job.id} (pid ${delegated.pid}) for task ${params.taskId}.`,
              delegated.worktreePath ? `Worktree: ${delegated.worktreePath}` : "",
            ].filter(Boolean).join("\n"),
          }],
          details: {
            taskId: params.taskId,
            jobId: delegated.job.id,
            workerSessionId: delegated.workerSession.id,
            worktreePath: delegated.worktreePath,
            pid: delegated.pid,
          },
        };
      },
    });
  }

  private registerStatusCommand(): void {
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

function canonicalWorkspace(path: string, label: string): string {
  const absolutePath = resolve(path);
  try {
    if (!statSync(absolutePath).isDirectory()) throw new Error("not a directory");
    return realpathSync(absolutePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not an accessible directory: ${absolutePath} (${detail})`);
  }
}
