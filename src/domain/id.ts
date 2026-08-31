/** Creates application-owned construct IDs before database or file creation. */
export class Id {
  private constructor() {}

  static create(): Id {
    return new Id();
  }

  createProjectId(): string {
    return `project_${crypto.randomUUID()}`;
  }

  createTaskId(): string {
    return `task_${crypto.randomUUID()}`;
  }

  createJobId(): string {
    return `job_${crypto.randomUUID()}`;
  }

  createWorkerSessionId(): string {
    return `session_${crypto.randomUUID()}`;
  }
}
