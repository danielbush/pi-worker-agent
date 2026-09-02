import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { DATA_ROOT } from "../config.ts";
import { Id } from "../domain/id.ts";
import { JOB_TYPES, type JobType } from "../domain/job.ts";
import { WorkspaceDirectory } from "../infrastructure/filesystem/workspace-directory.ts";
import {
  DetachedRunnerLauncher,
  type DetachedRunnerLaunch,
} from "../infrastructure/process/detached-runner-launcher.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { JobDelegator } from "../workflows/job-delegator.ts";
import { TaskCreator } from "../workflows/task-creator.ts";
import { WorkspaceRegistrar } from "../workflows/workspace-registrar.ts";
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
    this.registerWorkspaceTool();
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

  private registerWorkspaceTool(): void {
    this.pi.registerTool({
      name: "worker_register_workspace",
      label: "Register worker workspace",
      description: "Propose a filesystem path as an authorized worker workspace. Registration or creation occurs only after interactive user approval.",
      promptSnippet: "Ask the user to authorize a worker workspace",
      promptGuidelines: [
        "Use read-only tools to inspect the proposed path, repository instructions, or nearest existing parent before registration.",
        "Call worker_register_workspace only when the user has asked to set up that workspace; the application will independently verify it and ask the user to approve.",
        "Never describe a workspace as authorized until worker_register_workspace returns its workspace ID.",
      ],
      parameters: Type.Object({
        name: Type.String({ description: "Short workspace name" }),
        path: Type.String({ description: "Existing path, or path to create after approval" }),
        createIfMissing: Type.Optional(Type.Boolean({ description: "Create the directory after approval when it does not exist" })),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const directories = WorkspaceDirectory.create(ctx.cwd);
        const preflight = directories.inspect(params.path);
        if (!preflight.exists && !params.createIfMissing) {
          throw new Error(`Workspace does not exist; set createIfMissing only if creation is intended: ${preflight.requestedPath}`);
        }
        if (!ctx.hasUI) throw new Error("Workspace registration requires interactive user approval");
        const action = preflight.exists ? "Register existing directory" : "Create and register directory";
        const approved = await ctx.ui.confirm(
          "Authorize worker workspace?",
          [
            `Name: ${params.name}`,
            `Path: ${preflight.canonicalPath}`,
            `Action: ${action}`,
            `Git repository: ${preflight.gitRepository ? "yes" : "no"}`,
            "Workers may read this path and create isolated worktrees from Git repositories.",
          ].join("\n"),
        );
        if (!approved) throw new Error("Workspace authorization declined by user");
        const registry = this.registry ??= this.services.registry();
        const workspace = WorkspaceRegistrar.create(registry, directories, Id.create()).register({
          name: params.name,
          preflight,
          createIfMissing: params.createIfMissing ?? false,
          userApproved: true,
          approvedBySessionId: ctx.sessionManager.getSessionId(),
        });
        return {
          content: [{
            type: "text",
            text: `Authorized workspace ${workspace.name} (${workspace.id}).\nPath: ${workspace.rootDir}`,
          }],
          details: { workspaceId: workspace.id, name: workspace.name, workspaceRoot: workspace.rootDir },
        };
      },
    });
  }

  private registerTaskTool(): void {
    this.pi.registerTool({
      name: "worker_create_task",
      label: "Create worker task",
      description: "Create a durable task with canonical intent, outcomes, and background against an authorized workspace.",
      promptSnippet: "Create a durable worker task against an authorized workspace",
      promptGuidelines: [
        "Use worker_create_task instead of temporary scripts, direct SQLite writes, or manual task-directory creation.",
        "Pass only a workspace ID returned by worker_register_workspace; worker_create_task cannot authorize a path.",
        "After worker_create_task succeeds, reference its UUID from the managed-project slice and .agent/tasks.md.",
      ],
      parameters: Type.Object({
        title: Type.String(),
        intent: Type.Optional(Type.String()),
        outcomes: Type.Optional(Type.String()),
        background: Type.String(),
        workspaceId: Type.String({ description: "ID of a user-authorized workspace" }),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const created = await TaskCreator.create(
          registry,
          this.services.taskStore(),
          Id.create(),
        ).create({
          workspaceId: params.workspaceId,
          title: params.title,
          intent: params.intent,
          outcomes: params.outcomes,
          background: params.background,
        });
        return {
          content: [{
            type: "text",
            text: `Created task ${created.task.id} for workspace ${created.project.name}.\nWorkspace: ${created.project.rootDir}`,
          }],
          details: { taskId: created.task.id, workspaceId: created.project.id, workspaceRoot: created.project.rootDir },
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
        "Before worker_delegate_job, read the target workspace's agent instructions and include relevant guidance in the canonical worker request.",
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
        if (!project.authorizedAt) throw new Error(`Task workspace is not authorized: ${project.id}`);
        const preflight = WorkspaceDirectory.create(ctx.cwd).inspect(project.rootDir);
        if (!preflight.exists || preflight.canonicalPath !== project.rootDir) {
          throw new Error(`Task workspace path changed or is inaccessible: ${project.rootDir}`);
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
