import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job, JobType } from "../../src/domain/job.ts";
import { capabilityForPurpose, profileFingerprint } from "../../src/domain/execution-profile.ts";
import { Registry } from "../../src/storage/registry.ts";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

function job(id: string, taskId: string, jobType: JobType, status: Job["status"]): Job {
  const capability = capabilityForPurpose(jobType);
  const profile = { name: "pi-medium", harness: "pi" as const, model: "default", options: { thinking: "medium" } };
  return {
    id,
    taskId,
    jobType,
    parentSessionId: "pi_manager",
    parentSessionFile: null,
    snapshotProvenance: "current",
    workerProfile: profile.name,
    profileFingerprint: profileFingerprint(profile),
    capabilityProfile: capability,
    harness: "pi",
    harnessVersion: "1.0.0-test",
    nativeInvocation: JSON.stringify({ executable: "/null/bin/pi", args: [] }),
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
  const registry = Registry.create(root);

  registry.transaction(() => {
    registry.workspaces.create({
      id: "workspace_test",
      name: "Greeting demo",
      rootDir: "/tmp/greeting-demo",
      createdAt: "2026-08-30T12:00:00Z",
      lastUsedAt: "2026-08-30T12:00:00Z",
    });
    registry.projects.create({
      id: "project_test",
      directoryName: "greeting-demo",
      title: "Greeting demo",
      description: "A test project",
      createdAt: "2026-08-30T12:00:00Z",
      lastUsedAt: "2026-08-30T12:00:00Z",
    });
    registry.tasks.create({
      id: "task_test",
      workspaceId: "workspace_test",
      title: "Implement greeting CLI",
      status: "queued",
      createdAt: "2026-08-30T12:00:00Z",
      finishedAt: null,
    });
    registry.projectTasks.create({
      projectId: "project_test",
      taskId: "task_test",
      addedAt: "2026-08-30T12:00:00Z",
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

  expect(registry.workspaces.get("workspace_test")?.name).toBe("Greeting demo");
  expect(registry.projects.get("project_test")?.title).toBe("Greeting demo");
  expect(registry.projectTasks.listTasks("project_test").map((task) => task.id)).toEqual(["task_test"]);
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

test("enforces metadata relationships", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-registry-"));
  roots.push(root);
  const registry = Registry.create(root);

  expect(() => registry.tasks.create({
    id: "task_invalid",
    workspaceId: "missing_workspace",
    title: "Invalid task",
    status: "queued",
    createdAt: "2026-08-30T12:00:00Z",
    finishedAt: null,
  })).toThrow();

  registry.close();
});
