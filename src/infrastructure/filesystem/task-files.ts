import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { WorkerAgentPaths } from "../../storage/paths.ts";

export interface CreateTaskFiles {
  taskId: string;
  background: string;
  intent?: string;
  outcomes?: string;
}

/**
 * INFRASTRUCTURE_WRAPPER.
 * Stores the architecture's file-based task data under `tasks/<task-id>/`:
 * optional `intent.md`, optional `outcomes.md`, and `background.md`.
 * Database metadata for the `tasks` table belongs to `Registry`, not here.
 */
export class TaskFiles {
  private constructor(
    private readonly paths: WorkerAgentPaths,
    private readonly records: Map<string, CreateTaskFiles> | undefined,
  ) {}

  static create(paths: WorkerAgentPaths): TaskFiles {
    return new TaskFiles(paths, undefined);
  }

  static createNull(paths: WorkerAgentPaths): TaskFiles {
    return new TaskFiles(paths, new Map());
  }

  async create(input: CreateTaskFiles): Promise<string> {
    const directory = this.paths.task(input.taskId);
    if (this.records) {
      this.records.set(input.taskId, structuredClone(input));
      return directory;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.write(this.paths.background(input.taskId), input.background);
    if (input.intent !== undefined) await this.write(this.paths.intent(input.taskId), input.intent);
    if (input.outcomes !== undefined) await this.write(this.paths.outcomes(input.taskId), input.outcomes);
    return directory;
  }

  private async write(path: string, content: string): Promise<void> {
    await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
  }
}
