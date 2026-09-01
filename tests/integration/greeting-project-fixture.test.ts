import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GreetingProjectFixture } from "../../src/demo/greeting-project-fixture.ts";
import { GitRepository } from "../../src/infrastructure/git/git-repository.ts";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";

const TASK_ID = "ab123456-1234-4123-8123-1234567890ab";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

test("creates a committed Bun greeting project with unfinished behavior", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-fixture-"));
  roots.push(root);
  const fixture = GreetingProjectFixture.create(join(root, ".examples"));

  const project = await fixture.create(TASK_ID);

  expect(project.name).toBe(`worker-demo-${TASK_ID}`);
  expect(project.rootDir).toBe(join(root, ".examples", `worker-demo-${TASK_ID}`));
  expect(project.baselineCommit).toMatch(/^[0-9a-f]{40,64}$/);
  expect(JSON.parse(readFileSync(join(project.rootDir, "package.json"), "utf8"))).toMatchObject({
    private: true,
    scripts: { test: "bun test" },
  });
  expect(readFileSync(join(project.rootDir, "src", "index.ts"), "utf8")).toContain("Not implemented");
  expect(readFileSync(join(project.rootDir, "src", "index.test.ts"), "utf8")).toContain("Hello, Ada!");
  expect(GitRepository.create(project.rootDir).status()).toBe("");
  await expect(fixture.create(TASK_ID)).rejects.toThrow();
});

test("rejects task IDs that could escape the examples directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-fixture-"));
  roots.push(root);
  const fixture = GreetingProjectFixture.create(join(root, ".examples"));

  await expect(fixture.create("../outside")).rejects.toThrow("Invalid task ID");
});
