import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "../src/domain/jobs.ts";
import { Registry } from "../src/storage/registry.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("runner writes progress, events, and a final artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-runner-"));
  roots.push(root);
  const bundlePath = join(root, "tasks", "job_runner_test");
  mkdirSync(bundlePath, { recursive: true });
  const registry = new Registry(root);
  const job: Job = {
    id: "job_runner_test",
    parentSessionId: "pi_test",
    parentSessionFile: null,
    harness: "demo",
    task: "prove detached artifacts work",
    cwd: root,
    status: "queued",
    pid: null,
    progress: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    bundlePath,
    resultPath: null,
    error: null,
    userNotified: false,
    agentNotified: false,
  };
  registry.create(job);
  registry.close();

  const process = Bun.spawn([
    "bun",
    join(import.meta.dir, "../src/runner/main.ts"),
    "--root",
    root,
    "--job",
    job.id,
  ], {
    env: { ...Bun.env, PI_WORKER_DEMO_STEP_MS: "5" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await process.exited).toBe(0);

  const completedRegistry = new Registry(root);
  expect(completedRegistry.get(job.id)).toMatchObject({ status: "completed", exitCode: 0, progress: "done" });
  completedRegistry.close();
  expect(existsSync(join(bundlePath, "events.jsonl"))).toBe(true);
  expect(readFileSync(join(bundlePath, "final.md"), "utf8")).toContain("prove detached artifacts work");
});
