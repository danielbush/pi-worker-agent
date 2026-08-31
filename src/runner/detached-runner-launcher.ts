/** Starts the durable runner in a detached Bun process. */
export class DetachedRunnerLauncher {
  constructor(private readonly entryPoint: string) {}

  launch(root: string, taskId: string, jobId: string, workerSessionId: string): number {
    const child = Bun.spawn([
      process.execPath,
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
