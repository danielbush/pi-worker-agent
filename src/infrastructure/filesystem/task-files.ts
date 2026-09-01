import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { WorkerAgentPaths } from "../../storage/paths.ts";

export interface CreateTaskFiles {
  taskId: string;
  background: string;
  intent?: string;
  outcomes?: string;
}

interface TaskFileDriver {
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<unknown>;
  writeFile(path: string, content: string, options: { encoding: "utf8"; mode: number }): Promise<unknown>;
  chmod(path: string, mode: number): Promise<unknown>;
}

/**
 * INFRASTRUCTURE_WRAPPER.
 * Stores the architecture's file-based task data under `tasks/<task-id>/`:
 * optional `intent.md`, optional `outcomes.md`, and `background.md`.
 * Database metadata for the `tasks` table belongs to `Registry`, not here.
 */
export class TaskFiles {
  constructor(
    private readonly paths: WorkerAgentPaths,
    private readonly driver: TaskFileDriver,
    private readonly records: CreateTaskFiles[],
  ) {}

  static create(paths: WorkerAgentPaths): TaskFiles {
    return new TaskFiles(paths, { mkdir, writeFile, chmod }, []);
  }

  static createNull(paths: WorkerAgentPaths): TaskFiles {
    return new TaskFiles(paths, {
      mkdir: async () => {},
      writeFile: async () => {},
      chmod: async () => {},
    }, []);
  }

  get state(): CreateTaskFiles[] {
    return structuredClone(this.records);
  }

  async create(input: CreateTaskFiles): Promise<string> {
    const directory = this.paths.task(input.taskId);
    await this.driver.mkdir(directory, { recursive: true, mode: 0o700 });
    await this.write(this.paths.background(input.taskId), input.background);
    if (input.intent !== undefined) await this.write(this.paths.intent(input.taskId), input.intent);
    if (input.outcomes !== undefined) await this.write(this.paths.outcomes(input.taskId), input.outcomes);
    this.records.push(structuredClone(input));
    return directory;
  }

  private async write(path: string, content: string): Promise<void> {
    await this.driver.writeFile(path, content, { encoding: "utf8", mode: 0o600 });
    await this.driver.chmod(path, 0o600);
  }
}
