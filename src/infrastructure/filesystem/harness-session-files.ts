import { copyFile, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface SessionFileEntry {
  name: string;
  isFile(): boolean;
  stubPath?: string;
}

interface HarnessSessionFileDriver {
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<unknown>;
  readdir(path: string, options: { withFileTypes: true }): Promise<SessionFileEntry[]>;
  copyAgentConfiguration(targetDirectory: string): Promise<void>;
}

/** INFRASTRUCTURE_WRAPPER: owns harness-native session directories and file discovery. */
export class HarnessSessionFiles {
  constructor(private readonly driver: HarnessSessionFileDriver) {}

  static create(): HarnessSessionFiles {
    return new HarnessSessionFiles({
      mkdir,
      readdir,
      copyAgentConfiguration: async (targetDirectory) => {
        const sourceDirectory = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
        for (const name of ["auth.json", "settings.json", "models-store.json"]) {
          try {
            await copyFile(join(sourceDirectory, name), join(targetDirectory, name));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      },
    });
  }

  static createNull(sessionPaths: Record<string, string | null> = {}): HarnessSessionFiles {
    return new HarnessSessionFiles({
      mkdir: async () => {},
      readdir: async () => Object.entries(sessionPaths).flatMap(([sessionId, path]) => path === null
        ? []
        : [{ name: sessionId, isFile: () => true, stubPath: path }]),
      copyAgentConfiguration: async () => {},
    });
  }

  async prepare(storagePath: string): Promise<string> {
    const directory = join(storagePath, "pi-session");
    await this.driver.mkdir(directory, { recursive: true, mode: 0o700 });
    await this.driver.mkdir(join(directory, "tmp"), { recursive: true, mode: 0o700 });
    const agentDirectory = join(directory, "tmp", "agent");
    await this.driver.mkdir(agentDirectory, { recursive: true, mode: 0o700 });
    await this.driver.copyAgentConfiguration(agentDirectory);
    return directory;
  }

  async find(directory: string, sessionId: string): Promise<string | null> {
    const entries = await this.driver.readdir(directory, { withFileTypes: true });
    const sessionFile = entries.find((entry) => entry.isFile() && entry.name.includes(sessionId));
    return sessionFile ? sessionFile.stubPath ?? join(directory, sessionFile.name) : null;
  }
}
