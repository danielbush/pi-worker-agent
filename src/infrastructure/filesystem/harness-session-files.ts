import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

/** INFRASTRUCTURE_WRAPPER: owns harness-native session directories and file discovery. */
export class HarnessSessionFiles {
  private constructor(private readonly sessionPaths: Record<string, string | null> | undefined) {}

  static create(): HarnessSessionFiles {
    return new HarnessSessionFiles(undefined);
  }

  static createNull(sessionPaths: Record<string, string | null> = {}): HarnessSessionFiles {
    return new HarnessSessionFiles(structuredClone(sessionPaths));
  }

  async prepare(storagePath: string): Promise<string> {
    const directory = join(storagePath, "pi-session");
    if (!this.sessionPaths) await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async find(directory: string, sessionId: string): Promise<string | null> {
    if (this.sessionPaths) return this.sessionPaths[sessionId] ?? null;
    const entries = await readdir(directory, { withFileTypes: true });
    const sessionFile = entries.find((entry) => entry.isFile() && entry.name.includes(sessionId));
    return sessionFile ? join(directory, sessionFile.name) : null;
  }
}
