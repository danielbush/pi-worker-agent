import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessEnvironment, HarnessEnvironmentInput, PreparedHarnessEnvironment } from "../harness-environment.ts";
import { minimalWorkerEnvironment } from "./worker-environment.ts";

interface PiEnvironmentDriver {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  copyFile(source: string, destination: string): Promise<unknown>;
  chmod(path: string, mode: number): Promise<unknown>;
  remove(path: string): Promise<unknown>;
  home(): string;
  environment(): NodeJS.ProcessEnv;
}

/** Owns Pi credential staging and its minimal worker environment. */
export class PiHarnessEnvironment implements HarnessEnvironment {
  readonly harness = "pi" as const;
  readonly deniedReadPaths = ["~/.config/cursor", "~/.cursor"] as const;

  constructor(private readonly driver: PiEnvironmentDriver) {}

  static create(): PiHarnessEnvironment {
    return new PiHarnessEnvironment({
      mkdir,
      copyFile,
      chmod,
      remove: (path) => rm(path, { recursive: true, force: true }),
      home: homedir,
      environment: () => process.env,
    });
  }

  static createNull(source: NodeJS.ProcessEnv = { PATH: "/null/bin" }): PiHarnessEnvironment {
    return new PiHarnessEnvironment({
      mkdir: async () => {}, copyFile: async () => {}, chmod: async () => {}, remove: async () => {},
      home: () => "/null", environment: () => source,
    });
  }

  async prepare(input: HarnessEnvironmentInput): Promise<PreparedHarnessEnvironment> {
    const privateHome = join(input.temporaryDirectory, "home");
    const target = join(privateHome, ".pi", "agent");
    try {
      await this.driver.mkdir(target, { recursive: true, mode: 0o700 });
      const source = this.driver.environment().PI_CODING_AGENT_DIR ?? join(this.driver.home(), ".pi", "agent");
      for (const name of ["auth.json", "settings.json", "models-store.json"]) {
        try {
          const destination = join(target, name);
          await this.driver.copyFile(join(source, name), destination);
          await this.driver.chmod(destination, 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    } catch (error) {
      await this.driver.remove(privateHome);
      throw error;
    }
    const env = minimalWorkerEnvironment(this.driver.environment(), input.temporaryDirectory, privateHome);
    env.PI_CODING_AGENT_DIR = target;
    return {
      env,
      cleanup: async () => { await this.driver.remove(privateHome); },
    };
  }
}
