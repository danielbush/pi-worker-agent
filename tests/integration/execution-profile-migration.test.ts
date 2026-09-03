import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileFingerprint } from "../../src/domain/execution-profile.ts";
import { Registry } from "../../src/storage/registry.ts";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeTestDirectory(root); });

test("fresh schema binds catalog relationships and complete snapshots", () => {
  const root = temp("schema");
  Registry.create(root).close();
  const db = new Database(join(root, "registry.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  const jobColumns = db.query("PRAGMA table_info(jobs)").all() as Array<{ name: string; notnull: number }>;
  for (const name of ["jobTypeId", "agentProfileId", "agentProfileSelectionSource"]) {
    expect(jobColumns.find((column) => column.name === name)?.notnull).toBe(1);
  }
  const typeColumns = db.query("PRAGMA table_info(jobTypes)").all() as Array<{ name: string; notnull: number }>;
  for (const name of ["capabilityProfile", "worktreeStrategy", "defaultAgentProfileId", "retired"]) {
    expect(typeColumns.find((column) => column.name === name)?.notnull).toBe(1);
  }
  expect(() => db.query("INSERT INTO agentProfiles (id,harness,model,options,createdAt,updatedAt) VALUES ('bad','pi','model','{\"thinking\":1}','now','now')").run()).toThrow("options must contain only strings");
  expect(() => db.query("INSERT INTO tasks (id,title,status,createdAt,profileOverrides) VALUES ('bad','Bad','queued','now','{}')").run()).toThrow();
  db.query("INSERT INTO tasks (id,title,status,createdAt) VALUES ('task','Task','queued','now')").run();
  expect(() => db.query(`INSERT INTO jobs
    (id,taskId,jobTypeId,agentProfileId,agentProfileSelectionSource,parentSessionId,snapshotProvenance,harness,model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath)
    VALUES ('partial','task','missing','missing','job-type-default','manager','current','pi','model','high','model','model','Partial','queued','now','/partial')`).run()).toThrow();
  expect(() => db.query("INSERT INTO workerSessions (id,jobId,storagePath,createdAt) VALUES ('foreign','missing','/tmp','now')").run()).toThrow();
  db.close();
});

test("fresh schema makes job assignment and execution snapshot immutable", () => {
  // arrange
  const root = temp("immutable-job");
  Registry.create(root).close();
  const db = new Database(join(root, "registry.sqlite"));
  db.exec(`
    PRAGMA foreign_keys = ON;
    INSERT INTO agentProfiles (id,harness,model,options,createdAt,updatedAt)
      VALUES ('pi','pi','model','{"thinking":"high"}','now','now');
    INSERT INTO jobTypes (id,capabilityProfile,worktreeStrategy,defaultAgentProfileId,createdAt,updatedAt)
      VALUES ('plan','read-only','workspace','pi','now','now');
    INSERT INTO tasks (id,title,status,createdAt) VALUES ('task','Task','queued','now');
    INSERT INTO jobs
      (id,taskId,jobTypeId,agentProfileId,agentProfileSelectionSource,parentSessionId,snapshotProvenance,
       profileFingerprint,profileOptions,capabilityProfile,harness,harnessVersion,nativeInvocation,
       model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath)
      VALUES ('job','task','plan','pi','job-type-default','manager','current',
       'fingerprint','{"thinking":"high"}','read-only','pi','1.0.0','{}',
       'model','high','model','version','Job','queued','now','/job');
  `);

  // act/assert
  expect(() => db.query("UPDATE jobs SET agentProfileSelectionSource = 'task-override' WHERE id = 'job'").run())
    .toThrow("job assignment is immutable");
  expect(() => db.query("UPDATE jobs SET profileOptions = '{}' WHERE id = 'job'").run())
    .toThrow("job execution snapshot is immutable");
  db.query("UPDATE jobs SET status = 'running' WHERE id = 'job'").run();
  expect(db.query("SELECT status FROM jobs WHERE id = 'job'").get()).toEqual({ status: "running" });
  db.close();
});

test("migrates v4 rows to binding archived catalog fossils", () => {
  const root = temp("v4");
  const db = new Database(join(root, "registry.sqlite"));
  db.exec(`
    PRAGMA user_version = 4;
    CREATE TABLE tasks (id TEXT PRIMARY KEY, workspaceId TEXT, title TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, finishedAt TEXT) STRICT;
    CREATE TABLE jobs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, jobType TEXT NOT NULL, parentSessionId TEXT NOT NULL, parentSessionFile TEXT, harness TEXT NOT NULL, model TEXT NOT NULL, effortLevel TEXT NOT NULL, modelName TEXT NOT NULL, modelVersion TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, progress TEXT, createdAt TEXT NOT NULL, finishedAt TEXT, bundlePath TEXT NOT NULL, userNotified INTEGER NOT NULL DEFAULT 0, agentNotified INTEGER NOT NULL DEFAULT 0) STRICT;
    INSERT INTO tasks VALUES ('old-task', NULL, 'Old', 'completed', '2026-01-01', '2026-01-01');
    INSERT INTO jobs VALUES ('old-job', 'old-task', 'plan', 'manager', NULL, 'pi', 'old/model', 'medium', 'Old', 'old', 'Old', 'completed', NULL, '2026-01-01', '2026-01-01', '/old', 1, 1);
  `);
  db.close();

  const registry = Registry.create(root);
  expect(registry.tasks.get("old-task")).not.toHaveProperty("profileOverrides");
  expect(registry.jobs.get("old-job")).toMatchObject({
    jobTypeId: "plan", agentProfileId: "migration-fossil", agentProfileSelectionSource: "migration-fossil",
    snapshotProvenance: "migration-fossil", profileFingerprint: null, profileOptions: null,
    capabilityProfile: null, harnessVersion: null, nativeInvocation: null,
  });
  expect(registry.agentProfiles.get("migration-fossil")).toMatchObject({ retired: true });
  expect(registry.jobTypes.get("plan")).toMatchObject({ retired: true, defaultAgentProfileId: "migration-fossil" });
  registry.close();
});

test("migrates v6 profiles, job types, and canonical options", () => {
  const root = temp("v6");
  const db = new Database(join(root, "registry.sqlite"));
  db.exec(`
    PRAGMA user_version = 6;
    CREATE TABLE tasks (id TEXT PRIMARY KEY, workspaceId TEXT, title TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, finishedAt TEXT, profileOverrides TEXT) STRICT;
    CREATE TABLE jobs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, jobType TEXT NOT NULL, parentSessionId TEXT NOT NULL, parentSessionFile TEXT, snapshotProvenance TEXT NOT NULL, workerProfile TEXT, profileFingerprint TEXT, capabilityProfile TEXT, harness TEXT NOT NULL, harnessVersion TEXT, nativeInvocation TEXT, model TEXT NOT NULL, effortLevel TEXT NOT NULL, modelName TEXT NOT NULL, modelVersion TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, progress TEXT, createdAt TEXT NOT NULL, finishedAt TEXT, bundlePath TEXT NOT NULL, userNotified INTEGER NOT NULL DEFAULT 0, agentNotified INTEGER NOT NULL DEFAULT 0) STRICT;
    INSERT INTO tasks VALUES ('task', NULL, 'Task', 'completed', 'now', 'now', NULL);
  `);
  const pi = { name: "pi-high", harness: "pi" as const, model: "model", options: { thinking: "high" } };
  const cursor = { name: "cursor-old", harness: "cursor-agent" as const, model: "cursor-model-high", options: {} };
  const insert = db.query(`INSERT INTO jobs (id,taskId,jobType,parentSessionId,snapshotProvenance,workerProfile,profileFingerprint,capabilityProfile,harness,harnessVersion,nativeInvocation,model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("pi-job", "task", "plan", "manager", "current", pi.name, profileFingerprint(pi), "read-only", "pi", "1.0.0", '{"executable":"/bin/pi","args":[]}', pi.model, "high", "model", "model", "Pi", "completed", "now", "/pi");
  insert.run("cursor-job", "task", "implement", "manager", "current", cursor.name, profileFingerprint(cursor), "code", "cursor-agent", "1.0.0", '{"executable":"/bin/cursor","args":[]}', cursor.model, "", "model", "model", "Cursor", "completed", "now", "/cursor");
  db.close();

  const registry = Registry.create(root);
  expect(registry.jobs.get("pi-job")).toMatchObject({ agentProfileId: "pi-high", profileOptions: '{"thinking":"high"}' });
  expect(registry.jobs.get("cursor-job")).toMatchObject({ agentProfileId: "cursor-old", profileOptions: "{}" });
  expect(registry.agentProfiles.get("pi-high")).toMatchObject({ retired: true, options: '{"thinking":"high"}' });
  expect(registry.jobTypes.get("implement")).toMatchObject({ capabilityProfile: "code", worktreeStrategy: "new-worktree" });
  registry.close();
});

test("repository boundary rejects a corrupted current snapshot", () => {
  const root = temp("boundary");
  const registry = Registry.create(root);
  registry.agentProfiles.create({ id: "pi", description: null, harness: "pi", model: "model", options: '{"thinking":"high"}', retired: false, archiveDate: null, createdAt: "now", updatedAt: "now" });
  registry.jobTypes.create({ id: "plan", description: null, capabilityProfile: "read-only", worktreeStrategy: "workspace", defaultAgentProfileId: "pi", retired: false, archiveDate: null, createdAt: "now", updatedAt: "now" });
  registry.tasks.create({ id: "task", workspaceId: null, title: "Task", status: "queued", createdAt: "now", finishedAt: null });
  registry.close();
  const corrupt = new Database(join(root, "registry.sqlite"));
  corrupt.exec("PRAGMA ignore_check_constraints = ON; DROP TRIGGER jobs_execution_snapshot_insert; DROP TRIGGER jobs_execution_snapshot_update; DROP TRIGGER jobs_active_assignment_insert");
  corrupt.query(`INSERT INTO jobs
    (id,taskId,jobTypeId,agentProfileId,agentProfileSelectionSource,parentSessionId,snapshotProvenance,harness,model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath)
    VALUES ('partial','task','plan','pi','job-type-default','manager','current','pi','model','high','model','model','Partial','queued','now','/partial')`).run();
  corrupt.close();
  const reopened = Registry.create(root);
  expect(() => reopened.jobs.get("partial")).toThrow("partial current execution snapshot");
  reopened.close();
});

function temp(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `pi-worker-profile-${label}-`));
  roots.push(root);
  return root;
}
