import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job, JobType } from "../src/domain/job.ts";
import { Registry } from "../src/storage/registry.ts";
import { removeTestDirectory } from "./test-directory.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

function job(id: string, taskId: string, jobType: JobType, status: Job["status"]): Job {
  return {
    id,
    taskId,
    jobType,
    parentSessionId: "pi_manager",
    parentSessionFile: null,
    harness: "pi",
    model: "default",
    effortLevel: "medium",
    modelName: "default",
    modelVersion: "unknown",
    title: `${jobType} greeting CLI`,
    status,
    progress: null,
    createdAt: "2026-08-30T12:00:00Z",
    finishedAt: null,
    bundlePath: `/data/tasks/${taskId}/jobs/${id}`,
    userNotified: false,
    agentNotified: false,
  };
}

test("composes project, task, job, session, and dependency repositories", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-registry-"));
  roots.push(root);
  const registry = new Registry(root);

  registry.transaction(() => {
    registry.projects.create({
      id: "project_test",
      name: "Greeting demo",
      rootDir: "/tmp/greeting-demo",
      createdAt: "2026-08-30T12:00:00Z",
      lastUsedAt: "2026-08-30T12:00:00Z",
    });
    registry.tasks.create({
      id: "task_test",
      projectId: "project_test",
      title: "Implement greeting CLI",
      status: "queued",
      createdAt: "2026-08-30T12:00:00Z",
      finishedAt: null,
    });
    registry.jobs.create(job("job_plan", "task_test", "plan", "queued"));
    registry.jobs.create(job("job_implement", "task_test", "implement", "blocked"));
    registry.jobs.create(job("job_review", "task_test", "review", "blocked"));
    registry.workerSessions.create({
      id: "session_plan",
      jobId: "job_plan",
      harnessSessionId: null,
      harnessSessionPath: null,
      storagePath: "/data/session_plan",
      createdAt: "2026-08-30T12:00:00Z",
    });
    registry.workerSessions.create({
      id: "session_implement",
      jobId: "job_implement",
      harnessSessionId: null,
      harnessSessionPath: null,
      storagePath: "/data/session_implement",
      createdAt: "2026-08-30T12:00:00Z",
    });
    registry.workerSessions.create({
      id: "session_review",
      jobId: "job_review",
      harnessSessionId: null,
      harnessSessionPath: null,
      storagePath: "/data/session_review",
      createdAt: "2026-08-30T12:00:00Z",
    });
    registry.jobDependencies.create({
      jobId: "job_implement",
      dependsOnJobId: "job_plan",
      relationship: "implements",
    });
    registry.jobDependencies.create({
      jobId: "job_review",
      dependsOnJobId: "job_implement",
      relationship: "reviews",
    });
  });

  expect(registry.projects.get("project_test")?.name).toBe("Greeting demo");
  expect(registry.tasks.get("task_test")?.status).toBe("queued");
  expect(registry.jobs.listForTask("task_test").map(({ id, status }) => ({ id, status }))).toEqual([
    { id: "job_plan", status: "queued" },
    { id: "job_implement", status: "blocked" },
    { id: "job_review", status: "blocked" },
  ]);
  expect(registry.workerSessions.getForJob("job_plan")?.id).toBe("session_plan");
  expect(registry.jobDependencies.listForJob("job_review")).toEqual([
    { jobId: "job_review", dependsOnJobId: "job_implement", relationship: "reviews" },
  ]);

  registry.jobs.updateStatus("job_plan", "completed", "done", "2026-08-30T12:01:00Z");
  registry.tasks.updateStatus("task_test", "running");
  expect(registry.jobs.get("job_plan")).toMatchObject({ status: "completed", progress: "done" });
  expect(registry.tasks.get("task_test")?.status).toBe("running");
  registry.close();
});

test("removes the obsolete prototype database schema", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-registry-"));
  roots.push(root);
  const legacy = new Database(join(root, "registry.sqlite"), { create: true });
  legacy.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL,
      task TEXT NOT NULL
    );
    INSERT INTO jobs VALUES ('legacy-job', 'legacy-session', 'legacy task');
  `);
  legacy.close();

  const registry = new Registry(root);
  const columns = registry.database.db.query("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;

  expect(columns.map((column) => column.name)).toContain("taskId");
  expect(registry.database.db.query("SELECT COUNT(*) AS count FROM jobs").get()).toEqual({ count: 0 });
  expect(registry.database.db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
  registry.close();
});

test("enforces metadata relationships", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-registry-"));
  roots.push(root);
  const registry = new Registry(root);

  expect(() => registry.tasks.create({
    id: "task_invalid",
    projectId: "missing_project",
    title: "Invalid task",
    status: "queued",
    createdAt: "2026-08-30T12:00:00Z",
    finishedAt: null,
  })).toThrow();

  registry.close();
});
