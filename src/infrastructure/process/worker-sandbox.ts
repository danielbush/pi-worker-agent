import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

export interface WorkerSandboxPolicy {
  writablePaths: string[];
  temporaryDirectory: string;
  deniedReadPaths?: string[];
}

export interface WorkerSandboxState {
  mode: "sandboxed" | "none";
  configurations: SandboxRuntimeConfig[];
  commands: string[];
  reset: boolean;
}

interface SandboxRuntimeDriver {
  initialize(config: SandboxRuntimeConfig): Promise<void>;
  checkDependencies(): boolean;
  wrapWithSandbox(command: string): Promise<string>;
  reset(): Promise<void>;
}

interface SandboxEnvironment {
  temporaryDirectory(): string | undefined;
  setTemporaryDirectory(path: string | undefined): void;
}

const NETWORK_DOMAINS = [
  "api.anthropic.com",
  "*.anthropic.com",
  "api.openai.com",
  "*.openai.com",
  "chatgpt.com",
  "*.chatgpt.com",
  "generativelanguage.googleapis.com",
  "oauth2.googleapis.com",
  // Cursor SDK account/catalog and agent-runtime endpoints; do not widen to wildcards.
  "api.cursor.com",
  "api2.cursor.sh",
  "api2direct.cursor.sh",
  "api3.cursor.sh",
];

/** INFRASTRUCTURE_WRAPPER: confines an entire worker harness process tree. */
export class WorkerSandbox {
  private readonly configurations: SandboxRuntimeConfig[] = [];
  private readonly commands: string[] = [];
  private wasReset = false;

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly runtime: SandboxRuntimeDriver,
    private readonly environment: SandboxEnvironment,
  ) {}

  static create(): WorkerSandbox {
    return new WorkerSandbox(process.platform, SandboxManager, {
      temporaryDirectory: () => process.env.TMPDIR,
      setTemporaryDirectory: (path) => {
        if (path === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = path;
      },
    });
  }

  static createNull(platform: NodeJS.Platform = "darwin", dependenciesAvailable = true): WorkerSandbox {
    let instance: WorkerSandbox;
    const runtime: SandboxRuntimeDriver = {
      initialize: async () => {},
      checkDependencies: () => dependenciesAvailable,
      wrapWithSandbox: async (command) => `sandboxed ${command}`,
      reset: async () => { instance.wasReset = true; },
    };
    let temporaryDirectory: string | undefined;
    instance = new WorkerSandbox(platform, runtime, {
      temporaryDirectory: () => temporaryDirectory,
      setTemporaryDirectory: (path) => { temporaryDirectory = path; },
    });
    return instance;
  }

  get state(): WorkerSandboxState {
    return {
      mode: "sandboxed",
      configurations: structuredClone(this.configurations),
      commands: [...this.commands],
      reset: this.wasReset,
    };
  }

  preflight(): void {
    this.assertSupported();
    if (!this.runtime.checkDependencies()) {
      throw new Error("Worker sandbox dependencies are unavailable; refusing to launch worker");
    }
  }

  async wrap(command: string[], policy: WorkerSandboxPolicy): Promise<string[]> {
    this.preflight();

    const config: SandboxRuntimeConfig = {
      network: {
        allowedDomains: NETWORK_DOMAINS,
        deniedDomains: [],
      },
      filesystem: {
        denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gh", ...(policy.deniedReadPaths ?? [])],
        allowWrite: [...new Set(policy.writablePaths)],
        denyWrite: [],
      },
      enableWeakerNestedSandbox: false,
    };
    this.configurations.push(structuredClone(config));
    const previousTemporaryDirectory = this.environment.temporaryDirectory();
    this.environment.setTemporaryDirectory(policy.temporaryDirectory);
    try {
      await this.runtime.initialize(config);
      const shellCommand = command.map(shellArgument).join(" ");
      this.commands.push(shellCommand);
      return ["/bin/bash", "-c", await this.runtime.wrapWithSandbox(shellCommand)];
    } catch (error) {
      await this.runtime.reset();
      throw error;
    } finally {
      this.environment.setTemporaryDirectory(previousTemporaryDirectory);
    }
  }

  async reset(): Promise<void> {
    await this.runtime.reset();
  }

  private assertSupported(): void {
    if (this.platform === "win32") {
      throw new Error("Pi workers are unsupported on Windows until a Windows sandbox backend is configured");
    }
    if (this.platform !== "darwin" && this.platform !== "linux") {
      throw new Error(`Workers are unsupported on ${this.platform}: no sandbox backend is available`);
    }
  }
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
