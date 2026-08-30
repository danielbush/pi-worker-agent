import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "./db.ts";
import type { Job } from "./types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("creates and transitions a durable job", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-agent-"));
  roots.push(root);
  const registry = new Registry(root);
  const job: Job = {
    id: "job_test",
    parentSessionId: "pi_test",
    parentSessionFile: null,
    harness: "demo",
    task: "test task",
    cwd: root,
    status: "queued",
    pid: null,
    progress: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    bundlePath: join(root, "tasks", "job_test"),
    resultPath: null,
    error: null,
    userNotified: false,
    agentNotified: false,
  };

  registry.create(job);
  registry.markRunning(job.id, 123);
  registry.setProgress(job.id, "working");
  expect(registry.get(job.id)).toMatchObject({ status: "running", pid: 123, progress: "working" });

  registry.markCompleted(job.id, "/tmp/final.md");
  expect(registry.get(job.id)).toMatchObject({ status: "completed", exitCode: 0, resultPath: "/tmp/final.md" });
  registry.close();
});
