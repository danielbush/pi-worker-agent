import type { HarnessName } from "../../domain/execution-profile.ts";
import { CursorHarnessEnvironment } from "./harness-environments/cursor-harness-environment.ts";
import { PiHarnessEnvironment } from "./harness-environments/pi-harness-environment.ts";

export interface HarnessEnvironmentInput {
  temporaryDirectory: string;
}

export interface PreparedHarnessEnvironment {
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

export interface HarnessEnvironment {
  readonly harness: HarnessName;
  readonly deniedReadPaths: readonly string[];
  prepare(input: HarnessEnvironmentInput): Promise<PreparedHarnessEnvironment>;
}

/** Selects the credential and environment adapter owned by a harness. */
export class HarnessEnvironmentCatalog {
  private readonly environments: ReadonlyMap<HarnessName, HarnessEnvironment>;

  constructor(environments: readonly HarnessEnvironment[]) {
    this.environments = new Map(environments.map((environment) => [environment.harness, environment]));
  }

  static create(): HarnessEnvironmentCatalog {
    return new HarnessEnvironmentCatalog([
      PiHarnessEnvironment.create(),
      CursorHarnessEnvironment.create(),
    ]);
  }

  static createNull(source: NodeJS.ProcessEnv = { PATH: "/null/bin", MANAGER_SECRET: "must-not-leak", CURSOR_API_KEY: "cursor-selected" }): HarnessEnvironmentCatalog {
    return new HarnessEnvironmentCatalog([
      PiHarnessEnvironment.createNull(source),
      CursorHarnessEnvironment.createNull(source),
    ]);
  }

  deniedReadPaths(harness: HarnessName): string[] {
    return [...this.environment(harness).deniedReadPaths];
  }

  prepare(harness: HarnessName, input: HarnessEnvironmentInput): Promise<PreparedHarnessEnvironment> {
    return this.environment(harness).prepare(input);
  }

  private environment(harness: HarnessName): HarnessEnvironment {
    const environment = this.environments.get(harness);
    if (!environment) throw new Error(`No worker environment is registered for harness: ${harness}`);
    return environment;
  }
}
