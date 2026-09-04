import { PiExtension } from "../infrastructure/pi/pi-extension.ts";

const DEVELOPMENT_TOOL_NAMES = ["bash", "write", "edit"];

const MANAGER_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "worker_register_workspace",
  "worker_verify_project_structure",
  "worker_list_projects",
  "worker_manage_project_file",
  "worker_list_agent_profiles",
  "worker_manage_agent_profile",
  "worker_list_job_types",
  "worker_manage_job_type",
  "worker_register_project",
  "worker_prepare_diagnostic_project",
  "worker_archive_project",
  "worker_add_task_to_project",
  "worker_project_tasks",
  "worker_task_status",
  "worker_create_task",
  "worker_complete_task",
  "worker_inspect_job_changes",
  "worker_open_job_worktree",
  "worker_merge_job",
  "worker_list_models",
  "worker_delegate_job",
]);

export interface ManagerPermissionState {
  mode: "manager" | "development";
  activeTools: string[];
}

/** INFRASTRUCTURE_CONSUMER: enforces the manager's tool boundary through the Pi wrapper. */
export class ManagerPermissions {
  private developmentMode = false;
  private developmentTools: string[] = [];

  constructor(private readonly pi: PiExtension) {}

  static create(pi: PiExtension): ManagerPermissions {
    return new ManagerPermissions(pi);
  }

  static createNull(activeTools: string[] = []): ManagerPermissions {
    return new ManagerPermissions(PiExtension.createNull(activeTools));
  }

  get state(): ManagerPermissionState {
    return {
      mode: this.developmentMode ? "development" : "manager",
      activeTools: this.pi.activeTools(),
    };
  }

  register(): void {
    this.pi.onSessionStart(async () => {
      this.startSession();
    });
    this.pi.onToolCall((toolName) => this.blockedToolCall(toolName));
    this.pi.registerCommand("development-mode", {
      description: "Explicitly enable unrestricted coding tools for this Pi session",
      handler: async (_args, ctx) => {
        if (!ctx.hasUI) {
          ctx.notify("Development mode requires interactive confirmation.", "error");
          return;
        }
        const confirmed = await ctx.confirm(
          "Enable development mode?",
          "This gives the agent unrestricted coding tools with your full user permissions for this session.",
        );
        if (!confirmed) return;
        this.enableDevelopment();
        ctx.notify(
          "Development mode enabled for this session. Return to restricted access with /manager-mode.",
          "warning",
        );
      },
    });
    this.pi.registerCommand("manager-mode", {
      description: "Return immediately to restricted manager tools",
      handler: async (_args, ctx) => {
        this.lock();
        ctx.notify("Manager mode enabled.", "info");
      },
    });
  }

  startSession(): void {
    this.developmentMode = false;
    this.developmentTools = [...new Set([
      ...this.developmentTools,
      ...this.pi.activeTools(),
      ...DEVELOPMENT_TOOL_NAMES,
    ])];
    this.lock();
  }

  lock(): void {
    this.developmentMode = false;
    this.pi.activateTools(this.pi.activeTools().filter((name) => MANAGER_TOOL_NAMES.has(name)));
  }

  enableDevelopment(): void {
    this.developmentMode = true;
    this.pi.activateTools(this.developmentTools);
  }

  blockedToolCall(toolName: string): { block: true; reason: string; terminate: true } | undefined {
    if (this.developmentMode || MANAGER_TOOL_NAMES.has(toolName)) return undefined;
    return {
      block: true,
      reason: `${toolName} is unavailable in manager mode; the user must explicitly enable development mode`,
      terminate: true,
    };
  }
}
