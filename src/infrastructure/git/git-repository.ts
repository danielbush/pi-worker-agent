import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface GitProcessResult {
  exitCode: number;
  stdout: { toString(): string };
  stderr: { toString(): string };
}

interface GitDriver {
  which(command: string): string | null;
  spawnSync(command: string[], options: { cwd: string; stdout: "pipe"; stderr: "pipe" }): GitProcessResult;
  mkdirSync(path: string, options: { recursive: true }): unknown;
}

/** INFRASTRUCTURE_WRAPPER: owns Git operations for projects and worktrees. */
export class GitRepository {
  constructor(
    readonly rootDir: string,
    private readonly driver: GitDriver,
  ) {}

  static create(rootDir: string): GitRepository {
    return new GitRepository(rootDir, {
      which: (command) => Bun.which(command),
      spawnSync: (command, options) => Bun.spawnSync(command, options),
      mkdirSync,
    });
  }

  static createNull(rootDir: string, commit = "0".repeat(40)): GitRepository {
    return new GitRepository(rootDir, {
      which: (command) => command,
      spawnSync: (command) => ({
        exitCode: 0,
        stdout: { toString: () => command.includes("rev-parse") ? commit : "" },
        stderr: { toString: () => "" },
      }),
      mkdirSync: () => undefined,
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

  head(): string {
    return this.run(["rev-parse", "HEAD"]);
  }

  changedFiles(): string[] {
    this.run(["add", "--intent-to-add", "--all"]);
    try {
      return this.run(["diff", "--name-only", "HEAD", "--"]).split("\n").filter(Boolean);
    } finally {
      this.run(["reset", "--quiet", "HEAD", "--"]);
    }
  }

  diff(): string {
    this.run(["add", "--intent-to-add", "--all"]);
    try {
      return this.run(["diff", "--binary", "HEAD", "--"]);
    } finally {
      this.run(["reset", "--quiet", "HEAD", "--"]);
    }
  }

  commitAll(message: string): string {
    this.run(["add", "--all"]);
    this.run([
      "-c", "user.name=pi-worker-agent",
      "-c", "user.email=pi-worker-agent@local",
      "commit", "--quiet", "-m", message,
    ]);
    return this.head();
  }

  cherryPick(commit: string): void {
    this.run(["cherry-pick", commit]);
  }

  abortCherryPick(): void {
    this.run(["cherry-pick", "--abort"]);
  }

  removeWorktree(path: string): void {
    this.run(["worktree", "remove", path]);
  }

  createWorktree(path: string): void {
    this.driver.mkdirSync(dirname(path), { recursive: true });
    this.run(["worktree", "add", "--detach", path, "HEAD"]);
  }

  private run(args: string[]): string {
    const executable = this.driver.which("git");
    if (!executable) throw new Error("git executable not found in PATH");

    const result = this.driver.spawnSync([executable, ...args], {
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
