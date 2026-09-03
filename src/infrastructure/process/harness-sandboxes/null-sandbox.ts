import type { HarnessSandbox } from "../harness-sandbox.ts";
import type { WorkerSandboxPolicy, WorkerSandboxState } from "../worker-sandbox.ts";

/** Explicit trusted-process strategy: preserves process/worktree isolation without an OS sandbox. */
export class NullSandbox implements HarnessSandbox {
  private readonly commands: string[][] = [];
  private wasReset = false;

  static create(): NullSandbox { return new NullSandbox(); }
  static createNull(): NullSandbox { return new NullSandbox(); }

  get state(): WorkerSandboxState {
    return {
      mode: "none",
      configurations: [],
      commands: this.commands.map((command) => command.join(" ")),
      reset: this.wasReset,
    };
  }

  preflight(): void {}

  async wrap(command: string[], _policy: WorkerSandboxPolicy): Promise<string[]> {
    this.commands.push([...command]);
    return [...command];
  }

  async reset(): Promise<void> { this.wasReset = true; }
}
