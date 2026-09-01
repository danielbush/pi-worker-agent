interface GitProcessResult {
  exitCode: number;
  stdout: { toString(): string };
  stderr: { toString(): string };
}

interface GitDriver {
  spawnSync(command: string[], options: { cwd: string; stdout: "pipe"; stderr: "pipe" }): GitProcessResult;
}

/** INFRASTRUCTURE_WRAPPER: owns Git operations for projects and worktrees. */
export class GitRepository {
  constructor(
    readonly rootDir: string,
    private readonly driver: GitDriver,
  ) {}

  static create(rootDir: string): GitRepository {
    return new GitRepository(rootDir, Bun as unknown as GitDriver);
  }

  static createNull(rootDir: string, commit = "0".repeat(40)): GitRepository {
    return new GitRepository(rootDir, {
      spawnSync: (command) => ({
        exitCode: 0,
        stdout: { toString: () => command.includes("rev-parse") ? commit : "" },
        stderr: { toString: () => "" },
      }),
    });
  }

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
    const result = this.driver.spawnSync(["git", ...args], {
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
