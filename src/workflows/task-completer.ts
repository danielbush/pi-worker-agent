import type { Task } from "../domain/task.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry, type NullRegistryState } from "../storage/registry.ts";

export interface NullTaskCompleterState {
  registry?: NullRegistryState;
  timestamp?: string;
}

/** INFRASTRUCTURE_CONSUMER: settles a manager-accepted task after its jobs have settled. */
export class TaskCompleter {
  constructor(
    private readonly registry: Registry,
    private readonly clock: Clock,
  ) {}

  static create(registry: Registry): TaskCompleter {
    return new TaskCompleter(registry, Clock.create());
  }

  static createNull(state: NullTaskCompleterState = {}): TaskCompleter {
    return new TaskCompleter(
      Registry.createNull(state.registry),
      Clock.createNull(state.timestamp),
    );
  }

  complete(taskReference: string): Task {
    const task = this.registry.tasks.resolve(taskReference);
    if (!task) throw new Error(`Unknown task: ${taskReference}`);
    if (task.status === "completed") return task;

    const jobs = this.registry.jobs.listForTask(task.id);
    if (jobs.length === 0) throw new Error(`Task has no jobs: ${task.id}`);
    const unsettled = jobs.filter((job) => ["blocked", "queued", "running"].includes(job.status));
    if (unsettled.length > 0) {
      throw new Error(`Task has unsettled jobs: ${unsettled.map((job) => job.id).join(", ")}`);
    }
    const finalJob = jobs.at(-1)!;
    if (finalJob.status !== "completed") {
      throw new Error(`Final job is not completed: ${finalJob.id} (${finalJob.status})`);
    }

    this.registry.tasks.updateStatus(task.id, "completed", this.clock.now());
    return this.registry.tasks.get(task.id)!;
  }
}
