import { JobDependencyRepository } from "./job-dependency-repository.ts";
import { JobRepository } from "./job-repository.ts";
import { ProjectRepository } from "./project-repository.ts";
import { RegistryDatabase } from "./registry-database.ts";
import { TaskRepository } from "./task-repository.ts";
import { WorkerSessionRepository } from "./worker-session-repository.ts";

/**
 * Composes the architecture's SQLite metadata bricks behind one lifecycle.
 * File-based task data and canonical events remain owned by `TaskStore`.
 */
export class Registry {
  readonly database: RegistryDatabase;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly jobs: JobRepository;
  readonly workerSessions: WorkerSessionRepository;
  readonly jobDependencies: JobDependencyRepository;

  constructor(root: string) {
    this.database = new RegistryDatabase(root);
    this.projects = new ProjectRepository(this.database);
    this.tasks = new TaskRepository(this.database);
    this.jobs = new JobRepository(this.database);
    this.workerSessions = new WorkerSessionRepository(this.database);
    this.jobDependencies = new JobDependencyRepository(this.database);
  }

  transaction<T>(work: () => T): T {
    return this.database.transaction(work);
  }

  close(): void {
    this.database.close();
  }
}
