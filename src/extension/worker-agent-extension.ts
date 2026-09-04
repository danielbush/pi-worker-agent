import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { DATA_ROOT } from "../config.ts";
import { Id } from "../domain/id.ts";
import type { JobType } from "../domain/job.ts";
import { FileSystem } from "../infrastructure/filesystem/file-system.ts";
import {
  DetachedRunnerLauncher,
  type DetachedRunnerLaunch,
} from "../infrastructure/process/detached-runner-launcher.ts";
import { PiExtension } from "../infrastructure/pi/pi-extension.ts";
import { WorktreeEditor } from "../infrastructure/process/worktree-editor.ts";
import { Registry } from "../storage/registry.ts";
import { TaskStore } from "../storage/task-store.ts";
import { CompletedWorkMerger } from "../workflows/completed-work-merger.ts";
import { DiagnosticProjectPreparer } from "../workflows/diagnostic-project-preparer.ts";
import { ExecutionCatalogManager } from "../workflows/execution-catalog-manager.ts";
import { JobDelegator } from "../workflows/job-delegator.ts";
import { ProjectArchiver } from "../workflows/project-archiver.ts";
import { ProjectCatalogReporter } from "../workflows/project-catalog-reporter.ts";
import { ProjectFileManager } from "../workflows/project-file-manager.ts";
import { ProjectRegistrar } from "../workflows/project-registrar.ts";
import { ProjectTaskLinker } from "../workflows/project-task-linker.ts";
import { ProjectTaskReporter } from "../workflows/project-task-reporter.ts";
import { ProjectStructureVerifier } from "../workflows/project-structure-verifier.ts";
import { TaskCompleter } from "../workflows/task-completer.ts";
import { TaskCreator } from "../workflows/task-creator.ts";
import { WorkspaceDirectory } from "../workflows/workspace-directory.ts";
import { WorkspaceRegistrar } from "../workflows/workspace-registrar.ts";
import { formatModelCatalog, ModelCatalog } from "../workflows/model-catalog.ts";
import { ManagerPermissions } from "./manager-permissions.ts";
import { WorkerCompletionMonitor } from "./worker-completion-monitor.ts";
import { formatTaskStatus, TaskStatusReporter } from "./task-status-reporter.ts";

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

/** INFRASTRUCTURE_CONSUMER: connects manager tools and lifecycle workflows through the Pi wrapper. */
export class WorkerAgentExtension {
  private registry: Registry | undefined;
  private completionMonitor: WorkerCompletionMonitor | undefined;
  private registered = false;

  constructor(
    private readonly pi: PiExtension,
    private readonly root: string,
    private readonly runner: DetachedRunnerLauncher,
    private readonly services: WorkerAgentServices,
  ) {}

  static create(pi: PiExtension): WorkerAgentExtension {
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
    const pi = PiExtension.createNull();
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
    this.registerExecutionCatalogTools();
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
    this.pi.onSessionStart(async (ctx) => {
      const registry = this.registry ??= this.services.registry();
      this.completionMonitor?.stop();
      this.completionMonitor = WorkerCompletionMonitor.create(
        registry,
        this.services.taskStore(),
        (message, level) => ctx.notify(message, level),
        (message) => this.pi.sendManagerMessage(message),
      );
      this.completionMonitor.start(ctx.sessionId);
    });

    this.pi.onSessionShutdown(async () => {
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
      execute: async (params, ctx) => {
        const directories = WorkspaceDirectory.create(ctx.cwd, FileSystem.create());
        const preflight = directories.inspect(params.path);
        if (!preflight.exists && !params.createIfMissing) {
          throw new Error(`Workspace does not exist; set createIfMissing only if creation is intended: ${preflight.requestedPath}`);
        }
        if (!ctx.hasUI) throw new Error("Workspace registration requires interactive user approval");
        const action = preflight.exists ? "Register existing directory" : "Create and register directory";
        const approved = await ctx.confirm(
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
          approvedBySessionId: ctx.sessionId,
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
      name: "worker_verify_project_structure",
      label: "Verify managed project structure",
      description: "Verify registered project metadata across active, test, and archive collection roots.",
      promptSnippet: "Verify that managed-project structure is in order",
      promptGuidelines: [
        "Call this before worker_list_projects at the start of managed-project work.",
        "If verification fails, stop and report every structural problem; do not silently ignore misplaced entries or improvise another project root.",
        "This verifies hard structural invariants only. Read PROJECT.md before interpreting policy-owned files inside project directories.",
      ],
      parameters: Type.Object({}),
      execute: async () => {
        const registry = this.registry ??= this.services.registry();
        const report = ProjectStructureVerifier.create(this.root, registry).verify();
        return {
          content: [{
            type: "text",
            text: [
              "Managed project structure is valid.",
              `DATA_ROOT=${report.dataRoot}`,
              `PROJECTS_ROOT=${report.projectsRoot}`,
              `TEST_ROOT=${report.roots.test}`,
              `ARCHIVE_ROOT=${report.roots.archive}`,
              `Managed project directories: ${report.projects.length}`,
              ...report.projects.map((project) => `- ${project.collection}/${project.directoryName} | registered ${project.id} | sequence.md present`),
            ].join("\n"),
          }],
          details: report,
        };
      },
    });

    this.pi.registerTool({
      name: "worker_list_projects",
      label: "List managed projects",
      description: "Validate manager configuration and list registered projects with the DATA_ROOT policy path.",
      promptSnippet: "Start managed-project work by listing configured projects",
      promptGuidelines: [
        "Call this after worker_verify_project_structure at the start of managed-project work.",
        "If it fails, stop and report the error without probing or improvising.",
        "Read the returned PROJECT.md before interpreting project files.",
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
              `PROJECT=${report.dataRoot}/PROJECT.md`,
              "Projects:",
              ...report.projects.map((project) => `- ${project.directoryName} | ${project.id} | ${project.title}`),
            ].join("\n"),
          }],
          details: report,
        };
      },
    });

    this.pi.registerTool({
      name: "worker_manage_project_file",
      label: "Manage project file",
      description: "Create, update, or delete a text file inside a registered policy-owned project directory with containment and stale-content checks.",
      promptSnippet: "Manage policy-owned files for a registered project",
      promptGuidelines: [
        "Read PROJECT.md and the target file before deciding what its contents mean or how to change it.",
        "Use only project-relative paths and preserve user-owned comments and policy content.",
        "For update and delete, pass the exact current file content as expectedContent; stale changes must be inspected again rather than overwritten.",
        "Call the returned line-by-line output a diff and report it clearly to the user.",
      ],
      parameters: Type.Object({
        project: Type.String({ description: "Project directory name, exact ID, or unique leading shorthand" }),
        relativePath: Type.String({ description: "Text-file path relative to the registered project directory" }),
        operation: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
        expectedContent: Type.Optional(Type.String({ description: "Exact inspected content required for update or delete" })),
        content: Type.Optional(Type.String({ description: "Complete replacement content required for create or update" })),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const result = ProjectFileManager.create(this.root, registry).manage(params);
        return {
          content: [{
            type: "text",
            text: [
              `${result.operation}d ${result.project.directoryName}/${result.relativePath}`,
              "diff:",
              result.diff,
            ].join("\n"),
          }],
          details: result,
        };
      },
    });

    this.pi.registerTool({
      name: "worker_register_project",
      label: "Register managed project",
      description: "Index an existing project under the active or test collection with durable identifying metadata.",
      promptSnippet: "Register a managed-project directory",
      promptGuidelines: [
        "Read the project's sequence.md first and preserve its title and intent when registering metadata.",
        "Only immediate directories under the selected collection root with sequence.md can be registered.",
      ],
      parameters: Type.Object({
        directoryName: Type.String(),
        title: Type.String(),
        description: Type.Optional(Type.String()),
        collection: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("test")])),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const project = ProjectRegistrar.create(this.root, registry, Id.create()).register(params);
        return {
          content: [{ type: "text", text: `Registered project ${project.title} (${project.id}).` }],
          details: { projectId: project.id, collection: project.collection, directoryName: project.directoryName },
        };
      },
    });

    this.pi.registerTool({
      name: "worker_prepare_diagnostic_project",
      label: "Prepare diagnostic project",
      description: "Prepare and return the conventional application-owned project and workspace in the test collection.",
      promptSnippet: "Prepare the conventional diagnostic project without asking the user to choose a workspace",
      parameters: Type.Object({}),
      execute: async () => {
        const registry = this.registry ??= this.services.registry();
        const result = DiagnosticProjectPreparer.create(this.root, registry).prepare();
        return {
          content: [{ type: "text", text: `Diagnostic project ready: ${result.project.id}\nWorkspace: ${result.workspace.id} (${result.workspace.rootDir})` }],
          details: { projectId: result.project.id, workspaceId: result.workspace.id, workspaceRoot: result.workspace.rootDir },
        };
      },
    });

    this.pi.registerTool({
      name: "worker_archive_project",
      label: "Archive managed project",
      description: "Move an active project into the archive collection while preserving its durable identity and task history.",
      promptSnippet: "Archive an active managed project",
      parameters: Type.Object({ project: Type.String({ description: "Active project directory name, exact ID, or unique leading shorthand" }) }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const project = ProjectArchiver.create(this.root, registry).archive(params.project);
        return {
          content: [{ type: "text", text: `Archived project ${project.title} (${project.id}) as ${project.directoryName}.` }],
          details: project,
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
      execute: async (params) => {
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
      execute: async (params) => {
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

  private registerExecutionCatalogTools(): void {
    this.pi.registerTool({
      name: "worker_list_agent_profiles",
      label: "List agent profiles",
      description: "List durable manager-configured agent profiles and archival state.",
      promptSnippet: "List configured agent profiles",
      parameters: Type.Object({}),
      execute: async () => {
        const registry = this.registry ??= this.services.registry();
        const profiles = ExecutionCatalogManager.create(registry).listAgentProfiles();
        const text = profiles.length ? profiles.map((profile) =>
          `${profile.id} | ${profile.retired ? "retired" : "active"} | ${profile.harness} | ${profile.model} | ${profile.options} | ${profile.description ?? ""}`,
        ).join("\n") : "No agent profiles configured.";
        return { content: [{ type: "text", text }], details: profiles };
      },
    });
    this.pi.registerTool({
      name: "worker_manage_agent_profile",
      label: "Manage agent profile",
      description: "Create, describe, retire, or reactivate one durable agent profile. Referenced execution settings are immutable.",
      promptSnippet: "Configure an agent profile before task execution",
      parameters: Type.Object({
        operation: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("describe"), Type.Literal("retire"), Type.Literal("reactivate")]),
        id: Type.String(),
        description: Type.Optional(Type.String()),
        harness: Type.Optional(Type.Union([Type.Literal("pi"), Type.Literal("cursor-agent")])),
        model: Type.Optional(Type.String()),
        options: Type.Optional(Type.Record(Type.String(), Type.String())),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const manager = ExecutionCatalogManager.create(registry);
        const profile = params.operation === "create"
          ? manager.createAgentProfile({
            id: params.id, description: params.description,
            harness: required(params.harness, "harness"), model: required(params.model, "model"),
            options: required(params.options, "options"),
          })
          : params.operation === "update" ? manager.updateAgentProfile(
            params.id, required(params.harness, "harness"), required(params.model, "model"), required(params.options, "options"),
          )
          : params.operation === "describe" ? manager.describeAgentProfile(params.id, params.description)
          : params.operation === "retire" ? manager.retireAgentProfile(params.id)
          : manager.reactivateAgentProfile(params.id);
        return { content: [{ type: "text", text: `Agent profile ${profile.id} is ${profile.retired ? "retired" : "active"}.` }], details: profile };
      },
    });
    this.pi.registerTool({
      name: "worker_list_job_types",
      label: "List job types",
      description: "List durable manager-configured job types, capabilities, worktree strategies, defaults, and archival state.",
      promptSnippet: "List configured job types",
      parameters: Type.Object({}),
      execute: async () => {
        const registry = this.registry ??= this.services.registry();
        const jobTypes = ExecutionCatalogManager.create(registry).listJobTypes();
        const text = jobTypes.length ? jobTypes.map((jobType) =>
          `${jobType.id} | ${jobType.retired ? "retired" : "active"} | ${jobType.capabilityProfile} | ${jobType.worktreeStrategy} | ${jobType.defaultAgentProfileId} | ${jobType.description ?? ""}`,
        ).join("\n") : "No job types configured.";
        return { content: [{ type: "text", text }], details: jobTypes };
      },
    });
    this.pi.registerTool({
      name: "worker_manage_job_type",
      label: "Manage job type",
      description: "Create, describe, set the default for, retire, or reactivate one durable job type.",
      promptSnippet: "Configure a job type before task execution",
      promptGuidelines: [
        "Treat the job-type ID as an opaque policy label whose workflow meaning comes from WORKFLOW.md.",
        "The database capability and worktree strategy control execution and can change only when the type has no active jobs.",
      ],
      parameters: Type.Object({
        operation: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("describe"), Type.Literal("set-default"), Type.Literal("retire"), Type.Literal("reactivate")]),
        id: Type.String(),
        description: Type.Optional(Type.String()),
        capabilityProfile: Type.Optional(Type.Union([Type.Literal("read-only"), Type.Literal("code"), Type.Literal("test")])),
        worktreeStrategy: Type.Optional(Type.Union([Type.Literal("workspace"), Type.Literal("new-worktree"), Type.Literal("dependency-worktree")])),
        defaultAgentProfileId: Type.Optional(Type.String()),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const manager = ExecutionCatalogManager.create(registry);
        const jobType = params.operation === "create"
          ? manager.createJobType({
            id: params.id, description: params.description,
            capabilityProfile: required(params.capabilityProfile, "capabilityProfile"),
            worktreeStrategy: required(params.worktreeStrategy, "worktreeStrategy"),
            defaultAgentProfileId: required(params.defaultAgentProfileId, "defaultAgentProfileId"),
          })
          : params.operation === "update" ? manager.updateJobType(
            params.id, required(params.capabilityProfile, "capabilityProfile"), required(params.worktreeStrategy, "worktreeStrategy"), required(params.defaultAgentProfileId, "defaultAgentProfileId"),
          )
          : params.operation === "describe" ? manager.describeJobType(params.id, params.description)
          : params.operation === "set-default" ? manager.setJobTypeDefault(params.id, required(params.defaultAgentProfileId, "defaultAgentProfileId"))
          : params.operation === "retire" ? manager.retireJobType(params.id)
          : manager.reactivateJobType(params.id);
        return { content: [{ type: "text", text: `Job type ${jobType.id} is ${jobType.retired ? "retired" : "active"}; default ${jobType.defaultAgentProfileId}.` }], details: jobType };
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
        "After worker_create_task succeeds, reference its UUID from the managed-project slice when the active PROJECT.md policy calls for it.",
      ],
      parameters: Type.Object({
        title: Type.String(),
        intent: Type.Optional(Type.String()),
        outcomes: Type.Optional(Type.String()),
        background: Type.String(),
        workspaceId: Type.String({ description: "Exact authorized workspace ID or unique leading shorthand" }),
        projectId: Type.String({ description: "Exact registered project ID or unique leading shorthand" }),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const created = await TaskCreator.create(
          registry,
          this.services.taskStore(),
          Id.create(),
        ).create({
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          title: params.title,
          intent: params.intent,
          outcomes: params.outcomes,
          background: params.background,
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
      description: "Inspect the changed files and git diff for a completed job that owns a worktree without modifying its project workspace.",
      promptSnippet: "Show completed work before the user decides whether to merge it",
      promptGuidelines: [
        "Use this when WORKFLOW.md calls for inspection or the user asks to look at completed work before merging it.",
        "Describe the result, changed files, tests, and findings when available; call the line-by-line output a diff or git diff.",
        "Inspection does not authorize a merge.",
      ],
      parameters: Type.Object({
        jobId: Type.String({ description: "Exact completed job ID for a job that owns a worktree" }),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const inspection = CompletedWorkMerger.create(registry, this.services.taskStore()).inspect(params.jobId);
        return {
          content: [{
            type: "text",
            text: [
              `Completed job ${inspection.jobId}`,
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
      name: "worker_open_job_worktree",
      label: "Open completed job worktree",
      description: "Open a completed job's owned worktree using the user's EDITOR configuration.",
      promptSnippet: "Open completed work in the user's editor",
      promptGuidelines: [
        "Use this as part of inspection when WORKFLOW.md calls for it or the user asks to view completed work in their editor.",
        "The worktree path must come from the completed job; never accept or invent an arbitrary directory.",
        "If EDITOR is unavailable, report the setup error and keep the work unmerged.",
      ],
      parameters: Type.Object({
        jobId: Type.String({ description: "Exact completed job ID for a job that owns a worktree" }),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const inspection = CompletedWorkMerger.create(registry, this.services.taskStore()).inspect(params.jobId);
        const launch = WorktreeEditor.create().open(inspection.worktreePath);
        return {
          content: [{
            type: "text",
            text: `Opened completed job ${inspection.jobId} in ${launch.editor}.\nWorktree: ${launch.worktreePath}`,
          }],
          details: { ...inspection, editor: launch.editor, editorExecutable: launch.executable, pid: launch.pid },
        };
      },
    });

    this.pi.registerTool({
      name: "worker_merge_job",
      label: "Merge completed job",
      description: "Merge a completed job-owned worktree into its authorized project workspace after the user approves in conversation.",
      promptSnippet: "Merge completed work after the workflow and user approval allow it",
      promptGuidelines: [
        "Follow WORKFLOW.md to decide whether and when completed work should be offered for merge.",
        "Call this only when the user says to merge it; if they ask to look first, use worker_inspect_job_changes instead.",
        "The user's conversational approval authorizes the merge; do not ask them to approve a second time.",
      ],
      parameters: Type.Object({
        jobId: Type.String({ description: "Exact completed job ID for a job that owns a worktree" }),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const merger = CompletedWorkMerger.create(registry, this.services.taskStore());
        const merged = merger.merge(params.jobId);
        return {
          content: [{
            type: "text",
            text: `Merged job ${merged.jobId} into ${merged.workspaceRoot}.\nCommit: ${merged.commit}\nRemoved worktree: ${merged.worktreePath}`,
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
      description: "List live Pi and Cursor Agent model catalogs outside the worker sandbox and compare them to active agent-profile pins.",
      promptSnippet: "List live harness model catalogs and compare active agent-profile pins",
      promptGuidelines: [
        "Call worker_list_models before overriding a task onto Cursor or inventing a model id.",
        "Use only ids returned by the live catalog; agent-profile pins that are missing from the listing cannot be launched.",
        "A harness probe failure must be reported as-is; do not invent substitute model ids.",
      ],
      parameters: Type.Object({
        harness: Type.Optional(Type.Union([Type.Literal("pi"), Type.Literal("cursor-agent")], {
          description: "Optional harness to list; omit to list every configured harness",
        })),
      }),
      execute: async (params) => {
        const registry = this.registry ??= this.services.registry();
        const reports = ModelCatalog.create(registry.agentProfiles).discover(params.harness);
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
      execute: async (params) => {
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
      description: "Create and launch a configured job type for an existing task using its trusted capability, worktree strategy, and selected agent profile.",
      promptSnippet: "Create and launch the next configured worker job",
      promptGuidelines: [
        "Use worker_delegate_job instead of temporary scripts, direct SQLite writes, manual worktree creation, or direct runner invocation.",
        "Before worker_delegate_job, read the target workspace's agent instructions and include relevant guidance in the canonical worker request.",
        "Evaluate a completed dependency and re-read WORKFLOW.md before calling worker_delegate_job for the next workflow transition.",
        "Treat job-type IDs and dependency relationships as policy-defined labels; use the configured job type and relationship required by WORKFLOW.md.",
      ],
      parameters: Type.Object({
        taskId: Type.String({ description: "Exact task UUID or unique leading shorthand" }),
        jobType: Type.String({ description: "Active configured job-type ID" }),
        agentProfileId: Type.Optional(Type.String({ description: "Optional active profile ID; omit to use the job type default" })),
        title: Type.String(),
        request: Type.String({ description: "Complete canonical worker prompt, including relevant task context and accepted dependency results" }),
        dependsOnJobId: Type.Optional(Type.String()),
        relationship: Type.Optional(Type.String()),
      }),
      execute: async (params, ctx) => {
        const registry = this.registry ??= this.services.registry();
        const task = registry.tasks.resolve(params.taskId);
        if (!task) throw new Error(`Unknown task: ${params.taskId}`);
        const workspace = task.workspaceId ? registry.workspaces.get(task.workspaceId) : undefined;
        if (!workspace) throw new Error(`Task has no registered workspace: ${task.id}`);
        if (!workspace.authorizedAt) throw new Error(`Task workspace is not authorized: ${workspace.id}`);
        const preflight = WorkspaceDirectory.create(ctx.cwd, FileSystem.create()).inspect(workspace.rootDir);
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
          agentProfileId: params.agentProfileId,
          title: params.title,
          request: params.request,
          dependsOnJobId: params.dependsOnJobId,
          relationship: params.relationship,
          parentSessionId: ctx.sessionId,
          parentSessionFile: ctx.sessionFile ?? null,
        });
        return {
          content: [{
            type: "text",
            text: [
              `Started ${delegated.job.jobTypeId} job ${delegated.job.id} (pid ${delegated.pid}) for task ${task.id}.`,
              `Agent profile: ${delegated.job.agentProfileId} (${delegated.job.harness} ${delegated.job.model})`,
              delegated.worktreePath ? `Worktree: ${delegated.worktreePath}` : "",
            ].filter(Boolean).join("\n"),
          }],
          details: {
            taskId: task.id,
            jobId: delegated.job.id,
            jobTypeId: delegated.job.jobTypeId,
            workerSessionId: delegated.workerSession.id,
            worktreePath: delegated.worktreePath,
            pid: delegated.pid,
            agentProfileId: delegated.job.agentProfileId,
            agentProfileSelectionSource: delegated.job.agentProfileSelectionSource,
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
      execute: async (params) => {
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
          ctx.notify("Pass a task UUID or unique shorthand: /task-status <task-id>", "info");
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
            ctx.notify(`Unknown worker task: ${taskId}`, "error");
            return;
          }
          ctx.notify(formatTaskStatus(status, { includeResults: verbose }), "info");
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          ctx.notify(`Unable to read task status: ${detail}`, "error");
        }
      },
    });
  }
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required for this operation`);
  return value;
}
