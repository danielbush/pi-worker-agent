import { existsSync } from "node:fs";

interface DetachedProcess { pid: number; unref(): void; }
interface DetachedProcessDriver {
  which(command: string): string | null;
  exists(path: string): boolean;
  spawn(command: string[], options: { detached: true; stdin: "ignore"; stdout: "ignore"; stderr: "ignore"; env: Record<string, string>; }): DetachedProcess;
}
export interface DetachedRunnerLaunch { root: string; taskId: string; jobId: string; workerSessionId: string; }
export interface PreparedRunner { bunExecutable: string; entryPoint: string; }

/** INFRASTRUCTURE_WRAPPER: preflights and starts the durable runner using one resolved identity. */
export class DetachedRunnerLauncher {
  private readonly launches: DetachedRunnerLaunch[] = [];
  constructor(private readonly entryPoint: string, private readonly driver: DetachedProcessDriver) {}

  static create(entryPoint: string): DetachedRunnerLauncher {
    return new DetachedRunnerLauncher(entryPoint, { which: (name) => Bun.which(name), exists: existsSync, spawn: (command, options) => Bun.spawn(command, options) as unknown as DetachedProcess });
  }
  static createNull(entryPoint = "/null/runner/main.ts", pid = 1234): DetachedRunnerLauncher {
    return new DetachedRunnerLauncher(entryPoint, { which: () => "/null/bin/bun", exists: () => true, spawn: () => ({ pid, unref: () => {} }) });
  }
  get state(): DetachedRunnerLaunch[] { return structuredClone(this.launches); }

  preflight(): PreparedRunner {
    const bunExecutable = this.driver.which("bun");
    if (!bunExecutable || !bunExecutable.startsWith("/")) throw new Error("Detached runner Bun executable is unavailable as an absolute path");
    if (!this.driver.exists(this.entryPoint)) throw new Error(`Detached runner entry point is unavailable: ${this.entryPoint}`);
    return { bunExecutable, entryPoint: this.entryPoint };
  }

  launch(prepared: PreparedRunner, root: string, taskId: string, jobId: string, workerSessionId: string): number {
    this.launches.push({ root, taskId, jobId, workerSessionId });
    const child = this.driver.spawn([prepared.bunExecutable, prepared.entryPoint, root, taskId, jobId, workerSessionId], {
      detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    child.unref();
    return child.pid;
  }
}
