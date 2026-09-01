import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

interface SessionFileEntry {
  name: string;
  isFile(): boolean;
  stubPath?: string;
}

interface HarnessSessionFileDriver {
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<unknown>;
  readdir(path: string, options: { withFileTypes: true }): Promise<SessionFileEntry[]>;
}

/** INFRASTRUCTURE_WRAPPER: owns harness-native session directories and file discovery. */
export class HarnessSessionFiles {
  constructor(private readonly driver: HarnessSessionFileDriver) {}

  static create(): HarnessSessionFiles {
    return new HarnessSessionFiles({ mkdir, readdir });
  }

  static createNull(sessionPaths: Record<string, string | null> = {}): HarnessSessionFiles {
    return new HarnessSessionFiles({
      mkdir: async () => {},
      readdir: async () => Object.entries(sessionPaths).flatMap(([sessionId, path]) => path === null
        ? []
        : [{ name: sessionId, isFile: () => true, stubPath: path }]),
    });
  }

  async prepare(storagePath: string): Promise<string> {
    const directory = join(storagePath, "pi-session");
    await this.driver.mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async find(directory: string, sessionId: string): Promise<string | null> {
    const entries = await this.driver.readdir(directory, { withFileTypes: true });
    const sessionFile = entries.find((entry) => entry.isFile() && entry.name.includes(sessionId));
    return sessionFile ? sessionFile.stubPath ?? join(directory, sessionFile.name) : null;
  }
}
