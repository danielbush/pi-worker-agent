import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { DATA_ROOT } from "../config.ts";
import { Id } from "../domain/id.ts";
import type { JobType } from "../domain/job.ts";
import { WorkspaceDirectory } from "../infrastructure/filesystem/workspace-directory.ts";
import {
  DetachedRunnerLauncher,
  type DetachedRunnerLaunch,
} from "../infrastructure/process/detached-runner-launcher.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { CompletedWorkMerger } from "../workflows/completed-work-merger.ts";
import { JobDelegator } from "../workflows/job-delegator.ts";
import { ProjectCatalogReporter } from "../workflows/project-catalog-reporter.ts";
import { ProjectRegistrar } from "../workflows/project-registrar.ts";
import { ProjectTaskLinker } from "../workflows/project-task-linker.ts";
import { ProjectTaskReporter } from "../workflows/project-task-reporter.ts";
import { TaskCompleter } from "../workflows/task-completer.ts";
import { TaskCreator } from "../workflows/task-creator.ts";
import { WorkspaceRegistrar } from "../workflows/workspace-registrar.ts";
import { formatModelCatalog, ModelCatalog } from "../workflows/model-catalog.ts";
import { WorkflowProfileLoader } from "../workflows/workflow-profiles.ts";
import { ManagerPermissions } from "./manager-permissions.ts";
import { WorkerCompletionMonitor } from "./worker-completion-monitor.ts";
import { formatTaskStatus, TaskStatusReporter } from "./task-status-reporter.ts";

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
    this.registerProjectTools();
    this.registerTaskTool();
    this.registerTaskCompletionTool();
    this.registerCompletedWorkTools();
    this.registerModelCatalogTool();
    this.registerJobTool();
    this.registerTaskStatusTool();
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
          triggerTurn: true,
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

  private registerProjectTools(): void {
    this.pi.registerTool({
      name: "worker_list_projects",
      label: "List managed projects",
      description: "Validate manager configuration and list registered projects with the DATA_ROOT policy path.",
      promptSnippet: "Start managed-project work by listing configured projects",
      promptGuidelines: [
        "Call this first before any managed-project work.",
        "If it fails, stop and report the error without probing or improvising.",
        "Read the returned PROJECT_MANAGEMENT.md before interpreting project files.",
      ],
      parameters: Type.Object({}),
      execute: async () => {
        const registry = this.registry ??= this.services.registry();
        const report = ProjectCatalogReporter.create(this.root, registry).inspect();
        return {
          content: [{
            type: "text",
            text: [
              `DATA_ROOT=${report.dataRoot}`,
              `PROJECT_MANAGEMENT=${report.dataRoot}/PROJECT_MANAGEMENT.md`,
              "Projects:",
              ...report.projects.map((project) => `- ${project.directoryName} | ${project.id} | ${project.title}`),
            ].join("\n"),
          }],
          details: report,
        };
      },
    });

    this.pi.registerTool({
      name: "worker_register_project",
      label: "Register managed project",
      description: "Index an existing immediate subdirectory of $DATA_ROOT/projects with durable identifying metadata.",
      promptSnippet: "Register a managed-project directory",
      promptGuidelines: [
        "Read the project's sequence.md first and preserve its title and intent when registering metadata.",
        "Only immediate directories under $DATA_ROOT/projects with sequence.md can be registered.",
      ],
      parameters: Type.Object({
        directoryName: Type.String(),
        title: Type.String(),
        description: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const project = ProjectRegistrar.create(this.root, registry, Id.create()).register(params);
        return {
          content: [{ type: "text", text: `Registered project ${project.title} (${project.id}).` }],
          details: { projectId: project.id, directoryName: project.directoryName },
        };
      },
    });

    this.pi.registerTool({
      name: "worker_add_task_to_project",
      label: "Add task to project",
      description: "Associate an existing durable task with a registered management project.",
      promptSnippet: "Associate an existing task with a project",
      parameters: Type.Object({
        projectId: Type.String({ description: "Exact project ID or unique leading shorthand" }),
        taskId: Type.String({ description: "Exact task ID or unique leading shorthand" }),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const association = ProjectTaskLinker.create(registry).link(params.projectId, params.taskId);
        return {
          content: [{ type: "text", text: `Added task ${association.taskId} to project ${association.projectId}.` }],
          details: association,
        };
      },
    });

    this.pi.registerTool({
      name: "worker_project_tasks",
      label: "List project tasks",
      description: "List task titles and statuses for a registered management project using the projects_tasks join.",
      promptSnippet: "Check task status for a managed project",
      parameters: Type.Object({
        project: Type.String({ description: "Project directory name, exact ID, or unique leading shorthand" }),
        outstandingOnly: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const report = ProjectTaskReporter.create(registry).inspect(
          params.project,
          params.outstandingOnly ?? false,
        );
        const tasks = report.tasks.map((task) => {
          const jobs = registry.jobs.listForTask(task.id);
          return {
            ...task,
            jobs: jobs.length,
            activeJobs: jobs.filter((job) => ["blocked", "queued", "running"].includes(job.status)).length,
          };
        });
        const lines = tasks.length === 0
          ? ["No matching tasks."]
          : [
            "Task ID | Status | Jobs | Active | Title",
            ...tasks.map((task) => `${task.id} | ${task.status} | ${task.jobs} | ${task.activeJobs} | ${task.title}`),
          ];
        return {
          content: [{ type: "text", text: [`Project: ${report.project.title} (${report.project.id})`, ...lines].join("\n") }],
          details: { project: report.project, tasks },
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
        "Pass a workspace ID returned by worker_register_workspace and a project ID returned by worker_register_project; worker_create_task cannot authorize a path or invent a project.",
        "After worker_create_task succeeds, reference its UUID from the managed-project slice and .agent/tasks.md.",
      ],
      parameters: Type.Object({
        title: Type.String(),
        intent: Type.Optional(Type.String()),
        outcomes: Type.Optional(Type.String()),
        background: Type.String(),
        workspaceId: Type.String({ description: "Exact authorized workspace ID or unique leading shorthand" }),
        projectId: Type.String({ description: "Exact registered project ID or unique leading shorthand" }),
        profileOverrides: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Optional job-purpose to named worker-profile selections" })),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const created = await TaskCreator.create(
          registry,
          this.services.taskStore(),
          Id.create(),
          WorkflowProfileLoader.create(this.root),
        ).create({
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          title: params.title,
          intent: params.intent,
          outcomes: params.outcomes,
          background: params.background,
          profileOverrides: params.profileOverrides,
        });
        return {
          content: [{
            type: "text",
            text: `Created task ${created.task.id} for workspace ${created.workspace.name} and project ${created.projectId}.\nWorkspace: ${created.workspace.rootDir}`,
          }],
          details: { taskId: created.task.id, projectId: created.projectId, workspaceId: created.workspace.id, workspaceRoot: created.workspace.rootDir },
        };
      },
    });
  }

  private registerCompletedWorkTools(): void {
    this.pi.registerTool({
      name: "worker_inspect_job_changes",
      label: "Inspect completed job changes",
      description: "Inspect the changed files and git diff for a completed implementation job without modifying its project workspace.",
      promptSnippet: "Show a completed implementation before the user decides whether to merge it",
      promptGuidelines: [
        "Use this when the user asks to look at a completed implementation before merging it.",
        "Describe the result, changed files, tests, and review findings when available; call the line-by-line output a diff or git diff.",
        "Inspection does not authorize a merge.",
      ],
      parameters: Type.Object({
        jobId: Type.String({ description: "Exact completed implementation job ID" }),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const inspection = CompletedWorkMerger.create(registry, this.services.taskStore()).inspect(params.jobId);
        return {
          content: [{
            type: "text",
            text: [
              `Completed implementation job ${inspection.jobId}`,
              `Project workspace: ${inspection.workspaceName} (${inspection.workspaceRoot})`,
              "Changed files:",
              ...inspection.changedFiles.map((path) => `- ${path}`),
              "",
              "git diff:",
              inspection.diff || "(no diff)",
            ].join("\n"),
          }],
          details: inspection,
        };
      },
    });

    this.pi.registerTool({
      name: "worker_merge_job",
      label: "Merge completed job",
      description: "Merge a completed implementation job into its authorized project workspace after the user approves in conversation.",
      promptSnippet: "Merge completed implementation work after the user approves",
      promptGuidelines: [
        "After an implementation is ready, tell the user the job has finished and ask whether they want to merge it into the project.",
        "Call this only when the user says to merge it; if they ask to look first, use worker_inspect_job_changes instead.",
        "The user's conversational approval authorizes the merge; do not ask them to approve a second time.",
      ],
      parameters: Type.Object({
        jobId: Type.String({ description: "Exact completed implementation job ID" }),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const merger = CompletedWorkMerger.create(registry, this.services.taskStore());
        const merged = merger.merge(params.jobId);
        return {
          content: [{
            type: "text",
            text: `Merged job ${merged.jobId} into ${merged.workspaceRoot}.\nCommit: ${merged.commit}`,
          }],
          details: merged,
        };
      },
    });
  }

  private registerModelCatalogTool(): void {
    this.pi.registerTool({
      name: "worker_list_models",
      label: "List worker models",
      description: "List live Pi and Cursor Agent model catalogs outside the worker sandbox and compare them to WORKFLOW.md profile pins.",
      promptSnippet: "List live harness model catalogs and check WORKFLOW.md pins",
      promptGuidelines: [
        "Call worker_list_models before overriding a task onto Cursor or inventing a model id.",
        "Use only ids returned by the live catalog; WORKFLOW.md pins that are missing from the listing cannot be launched.",
        "A harness probe failure must be reported as-is; do not invent substitute model ids.",
      ],
      parameters: Type.Object({
        harness: Type.Optional(Type.Union([Type.Literal("pi"), Type.Literal("cursor-agent")], {
          description: "Optional harness to list; omit to list every configured harness",
        })),
      }),
      execute: async (_toolCallId, params) => {
        const reports = ModelCatalog.create(this.root).discover(params.harness);
        return {
          content: [{ type: "text", text: formatModelCatalog(reports) || "No harness catalogs available." }],
          details: reports,
        };
      },
    });
  }

  private registerTaskCompletionTool(): void {
    this.pi.registerTool({
      name: "worker_complete_task",
      label: "Complete worker task",
      description: "Mark a manager-accepted task complete after all of its jobs have settled.",
      promptSnippet: "Complete a task after evaluating its final required job",
      promptGuidelines: [
        "Call worker_complete_task only after evaluating the task outcomes and final required job according to WORKFLOW.md.",
        "Do not infer task acceptance merely from a worker process exiting successfully; review findings may require more work.",
      ],
      parameters: Type.Object({
        taskId: Type.String({ description: "Exact task UUID or unique leading shorthand" }),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const task = TaskCompleter.create(registry).complete(params.taskId);
        return {
          content: [{ type: "text", text: `Completed task ${task.id}: ${task.title}` }],
          details: { taskId: task.id, status: task.status, finishedAt: task.finishedAt },
        };
      },
    });
  }

  private registerJobTool(): void {
    this.pi.registerTool({
      name: "worker_delegate_job",
      label: "Delegate worker job",
      description: "Create and launch the next plan, implement, or review job for an existing task. Implement jobs receive isolated worktrees; review jobs inspect their dependency's worktree read-only.",
      promptSnippet: "Create and launch a plan, implement, or review worker job",
      promptGuidelines: [
        "Use worker_delegate_job instead of temporary scripts, direct SQLite writes, manual worktree creation, or direct runner invocation.",
        "Before worker_delegate_job, read the target workspace's agent instructions and include relevant guidance in the canonical worker request.",
        "Evaluate a completed dependency and re-read WORKFLOW.md before calling worker_delegate_job for the next workflow transition.",
        "Review jobs must depend on the completed implementation they inspect and use the reviews relationship.",
      ],
      parameters: Type.Object({
        taskId: Type.String({ description: "Exact task UUID or unique leading shorthand" }),
        jobType: Type.String({ description: "plan, implement, or review" }),
        title: Type.String(),
        request: Type.String({ description: "Complete canonical worker prompt, including relevant task context and accepted dependency results" }),
        dependsOnJobId: Type.Optional(Type.String()),
        relationship: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const registry = this.registry ??= this.services.registry();
        const task = registry.tasks.resolve(params.taskId);
        if (!task) throw new Error(`Unknown task: ${params.taskId}`);
        const workspace = task.workspaceId ? registry.workspaces.get(task.workspaceId) : undefined;
        if (!workspace) throw new Error(`Task has no registered workspace: ${task.id}`);
        if (!workspace.authorizedAt) throw new Error(`Task workspace is not authorized: ${workspace.id}`);
        const preflight = WorkspaceDirectory.create(ctx.cwd).inspect(workspace.rootDir);
        if (!preflight.exists || preflight.canonicalPath !== workspace.rootDir) {
          throw new Error(`Task workspace path changed or is inaccessible: ${workspace.rootDir}`);
        }
        const delegated = await JobDelegator.create(
          this.root,
          registry,
          this.services.taskStore(),
          Id.create(),
          this.runner,
        ).delegate({
          taskId: task.id,
          jobType: params.jobType as JobType,
          title: params.title,
          request: params.request,
          dependsOnJobId: params.dependsOnJobId,
          relationship: params.relationship,
          parentSessionId: ctx.sessionManager.getSessionId(),
          parentSessionFile: ctx.sessionManager.getSessionFile() ?? null,
        });
        return {
          content: [{
            type: "text",
            text: [
              `Started ${delegated.job.jobType} job ${delegated.job.id} (pid ${delegated.pid}) for task ${task.id}.`,
              `Profile: ${delegated.job.workerProfile} (${delegated.job.harness} ${delegated.job.model})`,
              delegated.worktreePath ? `Worktree: ${delegated.worktreePath}` : "",
            ].filter(Boolean).join("\n"),
          }],
          details: {
            taskId: task.id,
            jobId: delegated.job.id,
            workerSessionId: delegated.workerSession.id,
            worktreePath: delegated.worktreePath,
            pid: delegated.pid,
            workerProfile: delegated.job.workerProfile,
            profileFingerprint: delegated.job.profileFingerprint,
            capabilityProfile: delegated.job.capabilityProfile,
            harness: delegated.job.harness,
            harnessVersion: delegated.job.harnessVersion,
            nativeInvocation: delegated.job.nativeInvocation,
          },
        };
      },
    });
  }

  private registerTaskStatusTool(): void {
    this.pi.registerTool({
      name: "worker_task_status",
      label: "Show task status",
      description: "Show durable task and job status using an exact task ID or unique shorthand.",
      promptSnippet: "Inspect task status",
      parameters: Type.Object({
        taskId: Type.String({ description: "Exact task UUID or unique leading shorthand" }),
        verbose: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) => {
        const registry = this.registry ??= this.services.registry();
        const task = registry.tasks.resolve(params.taskId);
        if (!task) throw new Error(`Unknown worker task: ${params.taskId}`);
        const status = await TaskStatusReporter.create(registry, this.services.taskStore()).inspect(task.id);
        if (!status) throw new Error(`Unknown worker task: ${params.taskId}`);
        return {
          content: [{ type: "text", text: formatTaskStatus(status, { includeResults: params.verbose ?? false }) }],
          details: status,
        };
      },
    });
  }

  private registerStatusCommand(): void {
    this.pi.registerCommand("task-status", {
      description: "Show task status and its jobs; use --verbose for details and results",
      handler: async (args, ctx) => {
        const arguments_ = args.trim().split(/\s+/).filter(Boolean);
        const taskId = arguments_.find((argument) => !argument.startsWith("--"));
        const verbose = arguments_.includes("--verbose");
        if (!taskId) {
          ctx.ui.notify("Pass a task UUID or unique shorthand: /task-status <task-id>", "info");
          return;
        }
        try {
          const registry = this.registry ??= this.services.registry();
          const task = registry.tasks.resolve(taskId);
          const status = task ? await TaskStatusReporter.create(
            registry,
            this.services.taskStore(),
          ).inspect(task.id) : null;
          if (!status) {
            ctx.ui.notify(`Unknown worker task: ${taskId}`, "error");
            return;
          }
          ctx.ui.notify(formatTaskStatus(status, { includeResults: verbose }), "info");
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Unable to read task status: ${detail}`, "error");
        }
      },
    });
  }
}
