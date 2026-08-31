import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { WorkerAgentPaths } from "./paths.ts";

export interface CreateTaskFiles {
  taskId: string;
  background: string;
  intent?: string;
  outcomes?: string;
}

/**
 * Stores the architecture's file-based task data under `tasks/<task-id>/`:
 * optional `intent.md`, optional `outcomes.md`, and `background.md`.
 * Database metadata for the `tasks` table belongs to `Registry`, not here.
 */
export class TaskFiles {
  constructor(private readonly paths: WorkerAgentPaths) {}

  async create(input: CreateTaskFiles): Promise<string> {
    const directory = this.paths.task(input.taskId);
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
