import { GreetingProjectFiles } from "../infrastructure/filesystem/greeting-project-files.ts";
import { GitRepository } from "../infrastructure/git/git-repository.ts";

export interface GreetingProject {
  name: string;
  rootDir: string;
  baselineCommit: string;
}

/**
 * INFRASTRUCTURE_CONSUMER.
 * Generates the deterministic Bun project used as input to `/worker-demo`.
 * The resulting directory is an ordinary project that can be registered in
 * `projects`; this fixture does not create task metadata or launch workers.
 */
export class GreetingProjectFixture {
  constructor(
    private readonly examplesRoot: string,
    private readonly files: GreetingProjectFiles = GreetingProjectFiles.create(),
    private readonly nullCommit: string | undefined = undefined,
  ) {}

  static create(examplesRoot: string): GreetingProjectFixture {
    return new GreetingProjectFixture(examplesRoot, GreetingProjectFiles.create());
  }

  static createNull(
    examplesRoot = "/examples",
    baselineCommit = "0".repeat(40),
  ): GreetingProjectFixture {
    return new GreetingProjectFixture(examplesRoot, GreetingProjectFiles.createNull(), baselineCommit);
  }

  async create(taskId: string): Promise<GreetingProject> {
    this.assertTaskId(taskId);
    const name = `worker-demo-${taskId}`;
    const rootDir = await this.files.create({
      examplesRoot: this.examplesRoot,
      name,
      packageJson: `${JSON.stringify({
        name,
        private: true,
        type: "module",
        scripts: { test: "bun test" },
      }, null, 2)}\n`,
      source: STARTER_SOURCE,
      test: STARTER_TEST,
    });
    const git = this.nullCommit
      ? GitRepository.createNull(rootDir, this.nullCommit)
      : GitRepository.create(rootDir);
    const baselineCommit = git.initializeWithBaseline("Create greeting CLI starter");
    return { name, rootDir, baselineCommit };
  }

  private assertTaskId(taskId: string): void {
    if (!/^task_[a-zA-Z0-9-]+$/.test(taskId)) {
      throw new Error(`Invalid task ID: ${taskId}`);
    }
  }
}

const STARTER_SOURCE = `export function greeting(_name?: string): string {
  throw new Error("Not implemented");
}

if (import.meta.main) {
  console.log(greeting(Bun.argv[2]));
}
`;

const STARTER_TEST = `import { expect, test } from "bun:test";
import { greeting } from "./index.ts";

test("greets a supplied name", () => {
  expect(greeting("Ada")).toBe("Hello, Ada!");
});

test("greets the world by default", () => {
  expect(greeting()).toBe("Hello, world!");
});
`;
