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

test("fresh schema rejects malformed JSON and partial snapshots", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-profile-schema-"));
  roots.push(root);
  Registry.create(root).close();
  const db = new Database(join(root, "registry.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");

  // act/assert
  expect(() => db.query("INSERT INTO tasks (id,title,status,createdAt,profileOverrides) VALUES ('bad','Bad','queued','now','{')").run()).toThrow();
  db.query("INSERT INTO tasks (id,title,status,createdAt) VALUES ('task','Task','queued','now')").run();
  expect(() => db.query(`INSERT INTO jobs (id,taskId,jobType,parentSessionId,snapshotProvenance,workerProfile,harness,model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath) VALUES ('partial','task','plan','manager','current','profile','pi','model','high','model','model','Partial','queued','now','/partial')`).run()).toThrow();
  expect(() => db.query(`INSERT INTO jobs (id,taskId,jobType,parentSessionId,snapshotProvenance,harness,model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath) VALUES ('fake-fossil','task','plan','manager','current','pi','model','high','model','model','Fake','queued','now','/fake')`).run()).toThrow();
  expect(() => db.query("INSERT INTO workerSessions (id,jobId,storagePath,createdAt) VALUES ('foreign','missing','/tmp','now')").run()).toThrow();
  db.close();
});

test("migrates v4 rows as honest nullable fossils", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-profile-migration-"));
  roots.push(root);
  const db = new Database(join(root, "registry.sqlite"));
  db.exec(`
    PRAGMA user_version = 4;
    CREATE TABLE tasks (id TEXT PRIMARY KEY, workspaceId TEXT, title TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, finishedAt TEXT) STRICT;
    CREATE TABLE jobs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, jobType TEXT NOT NULL, parentSessionId TEXT NOT NULL, parentSessionFile TEXT, harness TEXT NOT NULL, model TEXT NOT NULL, effortLevel TEXT NOT NULL, modelName TEXT NOT NULL, modelVersion TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, progress TEXT, createdAt TEXT NOT NULL, finishedAt TEXT, bundlePath TEXT NOT NULL, userNotified INTEGER NOT NULL DEFAULT 0, agentNotified INTEGER NOT NULL DEFAULT 0) STRICT;
    INSERT INTO tasks VALUES ('old-task', NULL, 'Old', 'completed', '2026-01-01', '2026-01-01');
    INSERT INTO jobs VALUES ('old-job', 'old-task', 'plan', 'manager', NULL, 'pi', 'old/model', 'medium', 'Old', 'old', 'Old', 'completed', NULL, '2026-01-01', '2026-01-01', '/old', 1, 1);
  `);
  db.close();

  // act
  const registry = Registry.create(root);

  // assert
  expect(registry.tasks.get("old-task")?.profileOverrides).toBeNull();
  expect(registry.jobs.get("old-job")).toMatchObject({ snapshotProvenance: "migration-fossil", workerProfile: null, profileFingerprint: null, profileOptions: null, capabilityProfile: null, harnessVersion: null, nativeInvocation: null });
  registry.close();
});

test("migrates current v6 jobs to canonical profile options", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-profile-options-migration-"));
  roots.push(root);
  const db = new Database(join(root, "registry.sqlite"));
  db.exec(`
    PRAGMA user_version = 6;
    CREATE TABLE tasks (id TEXT PRIMARY KEY, workspaceId TEXT, title TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, finishedAt TEXT, profileOverrides TEXT) STRICT;
    CREATE TABLE jobs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, jobType TEXT NOT NULL, parentSessionId TEXT NOT NULL, parentSessionFile TEXT, snapshotProvenance TEXT NOT NULL, workerProfile TEXT, profileFingerprint TEXT, capabilityProfile TEXT, harness TEXT NOT NULL, harnessVersion TEXT, nativeInvocation TEXT, model TEXT NOT NULL, effortLevel TEXT NOT NULL, modelName TEXT NOT NULL, modelVersion TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, progress TEXT, createdAt TEXT NOT NULL, finishedAt TEXT, bundlePath TEXT NOT NULL, userNotified INTEGER NOT NULL DEFAULT 0, agentNotified INTEGER NOT NULL DEFAULT 0) STRICT;
    INSERT INTO tasks VALUES ('task', NULL, 'Task', 'completed', 'now', 'now', NULL);
  `);
  const piProfile = { name: "pi-high", harness: "pi" as const, model: "model", options: { thinking: "high" } };
  const cursorProfile = { name: "cursor-old", harness: "cursor-agent" as const, model: "cursor-model-high", options: {} };
  const insert = db.query(`INSERT INTO jobs (id,taskId,jobType,parentSessionId,snapshotProvenance,workerProfile,profileFingerprint,capabilityProfile,harness,harnessVersion,nativeInvocation,model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("pi-job", "task", "plan", "manager", "current", piProfile.name, profileFingerprint(piProfile), "read-only", "pi", "1.0.0", '{"executable":"/bin/pi","args":[]}', piProfile.model, "high", "model", "model", "Pi", "completed", "now", "/pi");
  insert.run("cursor-job", "task", "implement", "manager", "current", cursorProfile.name, profileFingerprint(cursorProfile), "code", "cursor-agent", "1.0.0", '{"executable":"/bin/cursor","args":[]}', cursorProfile.model, "", "model", "model", "Cursor", "completed", "now", "/cursor");
  db.close();

  // act
  const registry = Registry.create(root);

  // assert
  expect(registry.jobs.get("pi-job")?.profileOptions).toBe('{"thinking":"high"}');
  expect(registry.jobs.get("cursor-job")?.profileOptions).toBe("{}");
  registry.close();
});

test("mandatory repository boundary rejects malformed migrated values", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-profile-boundary-"));
  roots.push(root);
  const db = new Database(join(root, "registry.sqlite"));
  db.exec(`
    PRAGMA user_version = 4;
    CREATE TABLE tasks (id TEXT PRIMARY KEY, workspaceId TEXT, title TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, finishedAt TEXT) STRICT;
    CREATE TABLE jobs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, jobType TEXT NOT NULL, parentSessionId TEXT NOT NULL, parentSessionFile TEXT, harness TEXT NOT NULL, model TEXT NOT NULL, effortLevel TEXT NOT NULL, modelName TEXT NOT NULL, modelVersion TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, progress TEXT, createdAt TEXT NOT NULL, finishedAt TEXT, bundlePath TEXT NOT NULL, userNotified INTEGER NOT NULL DEFAULT 0, agentNotified INTEGER NOT NULL DEFAULT 0) STRICT;
    INSERT INTO tasks VALUES ('task', NULL, 'Task', 'queued', 'now', NULL);
  `);
  db.close();
  Registry.create(root).close();
  const corrupt = new Database(join(root, "registry.sqlite"));
  corrupt.query("UPDATE tasks SET profileOverrides = '{' WHERE id = 'task'").run();
  corrupt.exec("DROP TRIGGER jobs_execution_snapshot_insert; DROP TRIGGER jobs_execution_snapshot_update");
  corrupt.query(`INSERT INTO jobs (id,taskId,jobType,parentSessionId,snapshotProvenance,workerProfile,harness,model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath) VALUES ('partial','task','plan','manager','current','profile','pi','model','high','model','model','Partial','queued','now','/partial')`).run();
  corrupt.query(`INSERT INTO jobs (id,taskId,jobType,parentSessionId,snapshotProvenance,harness,model,effortLevel,modelName,modelVersion,title,status,createdAt,bundlePath) VALUES ('all-null-current','task','plan','manager','current','pi','model','high','model','model','Null current','queued','now','/null-current')`).run();
  corrupt.close();
  const registry = Registry.create(root);

  // act/assert
  expect(() => registry.tasks.get("task")).toThrow("malformed profile override JSON");
  expect(() => registry.jobs.get("partial")).toThrow("partial current execution snapshot");
  expect(() => registry.jobs.get("all-null-current")).toThrow("partial current execution snapshot");
  registry.close();
});
