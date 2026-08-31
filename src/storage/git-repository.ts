/** INFRASTRUCTURE_WRAPPER: owns Git operations for projects and worktrees. */
export class GitRepository {
  constructor(readonly rootDir: string) {}

  initializeWithBaseline(message: string): string {
    this.run(["init", "--quiet", "--initial-branch=main"]);
    this.run(["add", "--all"]);
    this.run([
      "-c", "user.name=pi-worker-agent",
      "-c", "user.email=pi-worker-agent@local",
      "commit", "--quiet", "-m", message,
    ]);
    return this.run(["rev-parse", "HEAD"]);
  }

  status(): string {
    return this.run(["status", "--porcelain"]);
  }

  private run(args: string[]): string {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: this.rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      const error = result.stderr.toString().trim();
      throw new Error(`git ${args[0]} failed${error ? `: ${error}` : ""}`);
    }
    return result.stdout.toString().trim();
  }
}
