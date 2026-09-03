import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessEnvironment, HarnessEnvironmentInput, PreparedHarnessEnvironment } from "../harness-environment.ts";
import { minimalWorkerEnvironment } from "./worker-environment.ts";

interface CursorEnvironmentDriver {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  copyFile(source: string, destination: string): Promise<unknown>;
  chmod(path: string, mode: number): Promise<unknown>;
  remove(path: string): Promise<unknown>;
  home(): string;
  environment(): NodeJS.ProcessEnv;
}

/** Owns Cursor SDK credential staging and its minimal worker environment. */
export class CursorHarnessEnvironment implements HarnessEnvironment {
  readonly harness = "cursor-agent" as const;
  readonly deniedReadPaths = ["~/.pi", "~/.config/cursor", "~/.cursor"] as const;

  constructor(private readonly driver: CursorEnvironmentDriver) {}

  static create(): CursorHarnessEnvironment {
    return new CursorHarnessEnvironment({
      mkdir,
      copyFile,
      chmod,
      remove: (path) => rm(path, { recursive: true, force: true }),
      home: homedir,
      environment: () => process.env,
    });
  }

  static createNull(source: NodeJS.ProcessEnv = { PATH: "/null/bin", CURSOR_API_KEY: "cursor-selected" }): CursorHarnessEnvironment {
    return new CursorHarnessEnvironment({
      mkdir: async () => {}, copyFile: async () => {}, chmod: async () => {}, remove: async () => {},
      home: () => "/null", environment: () => source,
    });
  }

  async prepare(input: HarnessEnvironmentInput): Promise<PreparedHarnessEnvironment> {
    const privateHome = join(input.temporaryDirectory, "home");
    const target = join(privateHome, ".cursor", "sdk");
    try {
      await this.driver.mkdir(target, { recursive: true, mode: 0o700 });
      try {
        const destination = join(target, "auth.json");
        await this.driver.copyFile(join(this.driver.home(), ".cursor", "sdk", "auth.json"), destination);
        await this.driver.chmod(destination, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } catch (error) {
      await this.driver.remove(privateHome);
      throw error;
    }
    const source = this.driver.environment();
    const env = minimalWorkerEnvironment(source, input.temporaryDirectory, privateHome);
    if (source.CURSOR_API_KEY) env.CURSOR_API_KEY = source.CURSOR_API_KEY;
    return {
      env,
      cleanup: async () => { await this.driver.remove(privateHome); },
    };
  }
}
