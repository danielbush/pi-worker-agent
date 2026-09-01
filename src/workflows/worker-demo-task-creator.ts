import type { Project } from "../domain/project.ts";
import type { Task } from "../domain/task.ts";
import type { Id } from "../domain/id.ts";
import { GreetingProjectFixture, type GreetingProject } from "../demo/greeting-project-fixture.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry, type NullRegistryState } from "../storage/registry.ts";
import { TaskStore, type NullTaskStoreState } from "../storage/task-store.ts";

export interface NullWorkerDemoTaskCreatorState {
  fixtureRoot?: string;
  baselineCommit?: string;
  registry?: NullRegistryState;
  taskStore?: NullTaskStoreState;
  timestamp?: string;
}

export interface CreatedWorkerDemoTask {
  project: Project;
  task: Task;
  fixture: GreetingProject;
}

/**
 * INFRASTRUCTURE_CONSUMER.
 * Creates `/worker-demo`'s real project and task constructs by composing the
 * fixture, file store, ID generator, and metadata registry bricks.
 */
export class WorkerDemoTaskCreator {
  constructor(
    private readonly fixture: GreetingProjectFixture,
    private readonly taskStore: TaskStore,
    private readonly registry: Registry,
    private readonly ids: Pick<Id, "createProjectId" | "createTaskId">,
    private readonly clock: Clock,
  ) {}

  static create(
    fixture: GreetingProjectFixture,
    taskStore: TaskStore,
    registry: Registry,
    ids: Pick<Id, "createProjectId" | "createTaskId">,
  ): WorkerDemoTaskCreator {
    return new WorkerDemoTaskCreator(fixture, taskStore, registry, ids, Clock.create());
  }

  static createNull(
    ids: Pick<Id, "createProjectId" | "createTaskId">,
    state: NullWorkerDemoTaskCreatorState = {},
  ): WorkerDemoTaskCreator {
    return new WorkerDemoTaskCreator(
      GreetingProjectFixture.createNull(state.fixtureRoot, state.baselineCommit),
      TaskStore.createNull(state.taskStore),
      Registry.createNull(state.registry),
      ids,
      Clock.createNull(state.timestamp),
    );
  }

  async create(): Promise<CreatedWorkerDemoTask> {
    const taskId = this.ids.createTaskId();
    const generated = await this.fixture.create(taskId);
    const timestamp = this.clock.now();
    const project: Project = {
      id: this.ids.createProjectId(),
      name: generated.name,
      rootDir: generated.rootDir,
      createdAt: timestamp,
      lastUsedAt: timestamp,
    };
    const task: Task = {
      id: taskId,
      projectId: project.id,
      title: "Implement greeting CLI",
      status: "queued",
      createdAt: timestamp,
      finishedAt: null,
    };

    await this.taskStore.tasks.create({
      taskId,
      intent: DEMO_INTENT,
      outcomes: DEMO_OUTCOMES,
      background: DEMO_BACKGROUND,
    });
    this.registry.transaction(() => {
      this.registry.projects.create(project);
      this.registry.tasks.create(task);
    });

    return { project, task, fixture: generated };
  }
}

export const DEMO_INTENT = "I want a tiny Bun CLI that turns a supplied name into a friendly greeting. Keep it simple and tested.\n";

export const DEMO_OUTCOMES = [
  "# Outcomes",
  "",
  "- [ ] `bun run src/index.ts Ada` prints `Hello, Ada!`.",
  "- [ ] Running it without a name prints `Hello, world!`.",
  "- [ ] `bun test` passes.",
  "",
].join("\n");

export const DEMO_BACKGROUND = [
  "# Background",
  "",
  "The generated project contains a minimal Bun package, starter source, and failing acceptance tests.",
  "",
].join("\n");
