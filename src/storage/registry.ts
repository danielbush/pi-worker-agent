import type { JobDependency } from "../domain/job-dependency.ts";
import type { Job } from "../domain/job.ts";
import type { Project } from "../domain/project.ts";
import type { ProjectTask } from "../domain/project-task.ts";
import type { Task } from "../domain/task.ts";
import type { Workspace } from "../domain/workspace.ts";
import type { WorkerSession } from "../domain/worker-session.ts";
import { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";
import { JobDependencyRepository } from "./job-dependency-repository.ts";
import { JobRepository } from "./job-repository.ts";
import { ProjectRepository } from "./project-repository.ts";
import { ProjectTaskRepository } from "./project-task-repository.ts";
import { TaskRepository } from "./task-repository.ts";
import { WorkspaceRepository } from "./workspace-repository.ts";
import { WorkerSessionRepository } from "./worker-session-repository.ts";

export interface NullRegistryState {
  workspaces?: Workspace[];
  projects?: Project[];
  projectTasks?: ProjectTask[];
  tasks?: Task[];
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
      JobRepository.create(database),
      WorkerSessionRepository.create(database),
      JobDependencyRepository.create(database),
      database,
    );
  }

  static createNull(state: NullRegistryState = {}): Registry {
    const tasks = TaskRepository.createNull(state.tasks);
    return new Registry(
      WorkspaceRepository.createNull(state.workspaces),
      ProjectRepository.createNull(state.projects),
      ProjectTaskRepository.createNull(state.projectTasks, (taskId) => tasks.get(taskId)),
      tasks,
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
