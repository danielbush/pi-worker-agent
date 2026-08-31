/** INFRASTRUCTURE_WRAPPER: starts the durable runner in a detached Bun process. */
export class DetachedRunnerLauncher {
  constructor(
    private readonly entryPoint: string,
    private readonly bunExecutable: string = Bun.which("bun") ?? "bun",
  ) {}

  launch(root: string, taskId: string, jobId: string, workerSessionId: string): number {
    const child = Bun.spawn([
      this.bunExecutable,
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
