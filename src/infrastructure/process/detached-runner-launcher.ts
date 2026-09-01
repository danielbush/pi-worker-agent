interface DetachedProcess {
  pid: number;
  unref(): void;
}

interface DetachedProcessDriver {
  which(command: string): string | null;
  spawn(command: string[], options: {
    detached: true;
    stdin: "ignore";
    stdout: "ignore";
    stderr: "ignore";
  }): DetachedProcess;
}

export interface DetachedRunnerLaunch {
  root: string;
  taskId: string;
  jobId: string;
  workerSessionId: string;
}

/** INFRASTRUCTURE_WRAPPER: starts the durable runner in a detached Bun process. */
export class DetachedRunnerLauncher {
  private readonly launches: DetachedRunnerLaunch[] = [];

  constructor(
    private readonly entryPoint: string,
    private readonly driver: DetachedProcessDriver,
  ) {}

  static create(entryPoint: string): DetachedRunnerLauncher {
    return new DetachedRunnerLauncher(entryPoint, Bun);
  }

  static createNull(entryPoint = "/null/runner/main.ts", pid = 1234): DetachedRunnerLauncher {
    return new DetachedRunnerLauncher(entryPoint, {
      which: () => "/null/bin/bun",
      spawn: () => ({ pid, unref: () => {} }),
    });
  }

  get state(): DetachedRunnerLaunch[] {
    return structuredClone(this.launches);
  }

  launch(root: string, taskId: string, jobId: string, workerSessionId: string): number {
    this.launches.push({ root, taskId, jobId, workerSessionId });
    const child = this.driver.spawn([
      this.driver.which("bun") ?? "bun",
      this.entryPoint,
      root,
      taskId,
      jobId,
      workerSessionId,
    ], {
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    child.unref();
    return child.pid;
  }
}
