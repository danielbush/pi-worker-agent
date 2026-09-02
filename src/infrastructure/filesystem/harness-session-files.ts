import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface SessionFileEntry {
  name: string;
  isFile(): boolean;
  stubPath?: string;
}

interface HarnessSessionFileDriver {
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  readdir(path: string, options: { withFileTypes: true }): Promise<SessionFileEntry[]>;
  remove(path: string): Promise<void>;
}

/** INFRASTRUCTURE_WRAPPER: owns canonical harness sessions and non-canonical private runtime directories. */
export class HarnessSessionFiles {
  constructor(private readonly driver: HarnessSessionFileDriver) {}

  static create(): HarnessSessionFiles {
    return new HarnessSessionFiles({
      mkdir,
      mkdtemp,
      readdir,
      remove: async (path) => { await rm(path, { recursive: true, force: true }); },
    });
  }

  static createNull(sessionPaths: Record<string, string | null> = {}): HarnessSessionFiles {
    return new HarnessSessionFiles({
      mkdir: async () => {},
      mkdtemp: async () => "/tmp/pi-worker-agent-null-private",
      readdir: async () => Object.entries(sessionPaths).flatMap(([sessionId, path]) => path === null
        ? []
        : [{ name: sessionId, isFile: () => true, stubPath: path }]),
      remove: async () => {},
    });
  }

  async prepare(storagePath: string): Promise<string> {
    const directory = join(storagePath, "harness-session");
    await this.driver.mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async createPrivateRuntimeDirectory(): Promise<string> {
    return this.driver.mkdtemp(join(tmpdir(), "pi-worker-agent-"));
  }

  async removePrivateRuntimeDirectory(path: string): Promise<void> {
    await this.driver.remove(path);
  }

  async find(directory: string, sessionId: string): Promise<string | null> {
    const entries = await this.driver.readdir(directory, { withFileTypes: true });
    const sessionFile = entries.find((entry) => entry.isFile() && entry.name.includes(sessionId));
    return sessionFile ? sessionFile.stubPath ?? join(directory, sessionFile.name) : null;
  }
}
