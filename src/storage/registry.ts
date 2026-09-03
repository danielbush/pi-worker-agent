import type { AgentProfile } from "../domain/agent-profile.ts";
import type { JobDependency } from "../domain/job-dependency.ts";
import type { Job } from "../domain/job.ts";
import type { JobTypeConfiguration } from "../domain/job-type.ts";
import type { Project } from "../domain/project.ts";
import type { ProjectTask } from "../domain/project-task.ts";
import type { TaskAgentProfileOverride } from "../domain/task-agent-profile-override.ts";
import type { Task } from "../domain/task.ts";
import type { Workspace } from "../domain/workspace.ts";
import type { WorkerSession } from "../domain/worker-session.ts";
import { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";
import { AgentProfileRepository } from "./agent-profile-repository.ts";
import { JobDependencyRepository } from "./job-dependency-repository.ts";
import { JobRepository } from "./job-repository.ts";
import { JobTypeRepository } from "./job-type-repository.ts";
import { ProjectRepository } from "./project-repository.ts";
import { ProjectTaskRepository } from "./project-task-repository.ts";
import { TaskAgentProfileOverrideRepository } from "./task-agent-profile-override-repository.ts";
import { TaskRepository } from "./task-repository.ts";
import { WorkspaceRepository } from "./workspace-repository.ts";
import { WorkerSessionRepository } from "./worker-session-repository.ts";

export interface NullRegistryState {
  workspaces?: Workspace[];
  projects?: Project[];
  projectTasks?: ProjectTask[];
  tasks?: Task[];
  agentProfiles?: AgentProfile[];
  jobTypes?: JobTypeConfiguration[];
  taskAgentProfileOverrides?: TaskAgentProfileOverride[];
  jobs?: Job[];
  workerSessions?: WorkerSession[];
  jobDependencies?: JobDependency[];
}

interface RegistryLifecycle {
  transaction<T>(work: () => T): T;
  close(): void;
}

/**
 * INFRASTRUCTURE_CONSUMER.
 * Composes the architecture's SQLite metadata bricks behind one lifecycle.
 * File-based task data and canonical events remain owned by `TaskStore`.
 */
export class Registry {
  constructor(
    readonly workspaces: WorkspaceRepository,
    readonly projects: ProjectRepository,
    readonly projectTasks: ProjectTaskRepository,
    readonly tasks: TaskRepository,
    readonly agentProfiles: AgentProfileRepository,
    readonly jobTypes: JobTypeRepository,
    readonly taskAgentProfileOverrides: TaskAgentProfileOverrideRepository,
    readonly jobs: JobRepository,
    readonly workerSessions: WorkerSessionRepository,
    readonly jobDependencies: JobDependencyRepository,
    private readonly lifecycle: RegistryLifecycle,
  ) {}

  static create(root: string): Registry {
    const database = RegistryDatabase.create(root);
    return new Registry(
      WorkspaceRepository.create(database),
      ProjectRepository.create(database),
      ProjectTaskRepository.create(database),
      TaskRepository.create(database),
      AgentProfileRepository.create(database),
      JobTypeRepository.create(database),
      TaskAgentProfileOverrideRepository.create(database),
      JobRepository.create(database),
      WorkerSessionRepository.create(database),
      JobDependencyRepository.create(database),
      database,
    );
  }

  static createNull(state: NullRegistryState = {}): Registry {
    const tasks = TaskRepository.createNull(state.tasks);
    const agentProfiles = state.agentProfiles ?? nullAgentProfiles(state.jobs ?? []);
    const jobTypes = state.jobTypes ?? nullJobTypes(agentProfiles[0]?.id ?? "pi-test");
    return new Registry(
      WorkspaceRepository.createNull(state.workspaces),
      ProjectRepository.createNull(state.projects),
      ProjectTaskRepository.createNull(state.projectTasks, (taskId) => tasks.get(taskId)),
      tasks,
      AgentProfileRepository.createNull(agentProfiles),
      JobTypeRepository.createNull(jobTypes),
      TaskAgentProfileOverrideRepository.createNull(state.taskAgentProfileOverrides),
      JobRepository.createNull(state.jobs),
      WorkerSessionRepository.createNull(state.workerSessions),
      JobDependencyRepository.createNull(state.jobDependencies),
      { transaction: (work) => work(), close: () => {} },
    );
  }

  transaction<T>(work: () => T): T {
    return this.lifecycle.transaction(work);
  }

  close(): void {
    this.lifecycle.close();
  }
}

function nullAgentProfiles(jobs: readonly Job[]): AgentProfile[] {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const byId = new Map<string, AgentProfile>();
  for (const job of jobs) {
    if (!job.agentProfileId || byId.has(job.agentProfileId)) continue;
    byId.set(job.agentProfileId, {
      id: job.agentProfileId, description: "Null agent profile",
      harness: job.harness === "cursor-agent" ? "cursor-agent" : "pi", model: job.model,
      options: job.profileOptions ?? (job.harness === "pi" ? '{"thinking":"high"}' : "{}"), retired: false, archiveDate: null,
      createdAt: timestamp, updatedAt: timestamp,
    });
  }
  if (!byId.size) byId.set("pi-test", {
    id: "pi-test", description: "Null agent profile", harness: "pi",
    model: "openai-codex/gpt-5.6-sol", options: '{"thinking":"high"}',
    retired: false, archiveDate: null, createdAt: timestamp, updatedAt: timestamp,
  });
  return [...byId.values()];
}

function nullJobTypes(defaultAgentProfileId: string): JobTypeConfiguration[] {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const values: Array<[string, JobTypeConfiguration["capabilityProfile"], JobTypeConfiguration["worktreeStrategy"]]> = [
    ["investigate", "read-only", "workspace"], ["plan", "read-only", "workspace"],
    ["implement", "code", "new-worktree"], ["review", "read-only", "dependency-worktree"],
    ["fix", "code", "dependency-worktree"], ["test", "test", "dependency-worktree"],
  ];
  return values.map(([id, capabilityProfile, worktreeStrategy]) => ({
    id, description: "Null job type", capabilityProfile, worktreeStrategy, defaultAgentProfileId,
    retired: false, archiveDate: null, createdAt: timestamp, updatedAt: timestamp,
  }));
}
