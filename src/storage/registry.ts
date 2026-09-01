import type { JobDependency } from "../domain/job-dependency.ts";
import type { Job } from "../domain/job.ts";
import type { Project } from "../domain/project.ts";
import type { Task } from "../domain/task.ts";
import type { WorkerSession } from "../domain/worker-session.ts";
import { JobDependencyRepository } from "./job-dependency-repository.ts";
import { JobRepository } from "./job-repository.ts";
import { ProjectRepository } from "./project-repository.ts";
import { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";
import { TaskRepository } from "./task-repository.ts";
import { WorkerSessionRepository } from "./worker-session-repository.ts";

export interface NullRegistryState {
  projects?: Project[];
  tasks?: Task[];
  jobs?: Job[];
  workerSessions?: WorkerSession[];
  jobDependencies?: JobDependency[];
}

/**
 * INFRASTRUCTURE_CONSUMER.
 * Composes the architecture's SQLite metadata bricks behind one lifecycle.
 * File-based task data and canonical events remain owned by `TaskStore`.
 */
export class Registry {
  readonly database: RegistryDatabase | undefined;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly jobs: JobRepository;
  readonly workerSessions: WorkerSessionRepository;
  readonly jobDependencies: JobDependencyRepository;

  constructor(root: string | undefined, nullState: NullRegistryState = {}) {
    if (root) {
      this.database = RegistryDatabase.create(root);
      this.projects = ProjectRepository.create(this.database);
      this.tasks = TaskRepository.create(this.database);
      this.jobs = JobRepository.create(this.database);
      this.workerSessions = WorkerSessionRepository.create(this.database);
      this.jobDependencies = JobDependencyRepository.create(this.database);
      return;
    }

    this.database = undefined;
    this.projects = ProjectRepository.createNull(nullState.projects);
    this.tasks = TaskRepository.createNull(nullState.tasks);
    this.jobs = JobRepository.createNull(nullState.jobs);
    this.workerSessions = WorkerSessionRepository.createNull(nullState.workerSessions);
    this.jobDependencies = JobDependencyRepository.createNull(nullState.jobDependencies);
  }

  static create(root: string): Registry {
    return new Registry(root);
  }

  static createNull(state: NullRegistryState = {}): Registry {
    return new Registry(undefined, state);
  }

  transaction<T>(work: () => T): T {
    return this.database ? this.database.transaction(work) : work();
  }

  close(): void {
    this.database?.close();
  }
}
