import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
  "worker_set_task_agent_profile",
  "worker_list_job_types",
  "worker_manage_job_type",
  "worker_register_project",
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

type ManagerPermissionPi = Pick<
  ExtensionAPI,
  "getActiveTools" | "on" | "registerCommand" | "setActiveTools"
>;

export interface ManagerPermissionState {
  mode: "manager" | "development";
  activeTools: string[];
}

/** INFRASTRUCTURE_WRAPPER: enforces the manager's Pi tool boundary. */
export class ManagerPermissions {
  private developmentMode = false;
  private developmentTools: string[] = [];

  constructor(private readonly pi: ManagerPermissionPi) {}

  static create(pi: ExtensionAPI): ManagerPermissions {
    return new ManagerPermissions(pi);
  }

  static createNull(activeTools: string[] = []): ManagerPermissions {
    let currentTools = [...activeTools];
    return new ManagerPermissions({
      getActiveTools: () => [...currentTools],
      setActiveTools: (tools: string[]) => { currentTools = [...tools]; },
      on: () => {},
      registerCommand: () => {},
    } as unknown as ManagerPermissionPi);
  }

  get state(): ManagerPermissionState {
    return {
      mode: this.developmentMode ? "development" : "manager",
      activeTools: this.pi.getActiveTools(),
    };
  }

  register(): void {
    this.pi.on("session_start", async () => {
      this.startSession();
    });
    this.pi.on("tool_call", async (event) => this.blockedToolCall(event.toolName));
    this.pi.registerCommand("development-mode", {
      description: "Explicitly enable unrestricted coding tools for this Pi session",
      handler: async (_args, ctx) => {
        if (!ctx.hasUI) {
          ctx.ui.notify("Development mode requires interactive confirmation.", "error");
          return;
        }
        const confirmed = await ctx.ui.confirm(
          "Enable development mode?",
          "This gives the agent unrestricted coding tools with your full user permissions for this session.",
        );
        if (!confirmed) return;
        this.enableDevelopment();
        ctx.ui.notify(
          "Development mode enabled for this session. Return to restricted access with /manager-mode.",
          "warning",
        );
      },
    });
    this.pi.registerCommand("manager-mode", {
      description: "Return immediately to restricted manager tools",
      handler: async (_args, ctx) => {
        this.lock();
        ctx.ui.notify("Manager mode enabled.", "info");
      },
    });
  }

  startSession(): void {
    this.developmentMode = false;
    this.developmentTools = [...new Set([
      ...this.developmentTools,
      ...this.pi.getActiveTools(),
      ...DEVELOPMENT_TOOL_NAMES,
    ])];
    this.lock();
  }

  lock(): void {
    this.developmentMode = false;
    this.pi.setActiveTools(this.pi.getActiveTools().filter((name) => MANAGER_TOOL_NAMES.has(name)));
  }

  enableDevelopment(): void {
    this.developmentMode = true;
    this.pi.setActiveTools(this.developmentTools);
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
