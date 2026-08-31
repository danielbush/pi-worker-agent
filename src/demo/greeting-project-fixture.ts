import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { GitRepository } from "../storage/git-repository.ts";

export interface GreetingProject {
  name: string;
  rootDir: string;
  baselineCommit: string;
}

/**
 * INFRASTRUCTURE_WRAPPER.
 * Generates the deterministic Bun project used as input to `/worker-demo`.
 * The resulting directory is an ordinary project that can be registered in
 * `projects`; this fixture does not create task metadata or launch workers.
 */
export class GreetingProjectFixture {
  constructor(private readonly examplesRoot: string) {}

  async create(taskId: string): Promise<GreetingProject> {
    this.assertTaskId(taskId);
    await mkdir(this.examplesRoot, { recursive: true });
    const name = `worker-demo-${taskId}`;
    const rootDir = join(this.examplesRoot, name);
    await mkdir(rootDir, { recursive: false });
    await mkdir(join(rootDir, "src"));

    await Promise.all([
      Bun.write(join(rootDir, "package.json"), `${JSON.stringify({
        name,
        private: true,
        type: "module",
        scripts: { test: "bun test" },
      }, null, 2)}\n`),
      Bun.write(join(rootDir, "src", "index.ts"), STARTER_SOURCE),
      Bun.write(join(rootDir, "src", "index.test.ts"), STARTER_TEST),
    ]);

    const git = new GitRepository(rootDir);
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
