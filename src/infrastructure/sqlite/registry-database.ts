import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

interface RegistryStatement {
  run(...parameters: unknown[]): unknown;
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

interface RegistryDatabaseConnection {
  exec(sql: string): unknown;
  query(sql: string): RegistryStatement;
  transaction<T>(work: () => T): () => T;
  close(): void;
}

type RegistryDatabaseConstructor = new (
  path: string,
  options: { create: boolean; strict: boolean },
) => RegistryDatabaseConnection;

interface RegistryFileDriver {
  mkdirSync(path: string, options: { recursive: boolean }): unknown;
}

export interface RegistryDatabaseState {
  statements: string[];
  closed: boolean;
}

/** INFRASTRUCTURE_WRAPPER: owns SQLite connection, schema, and transactions. */
export class RegistryDatabase {
  readonly db: RegistryDatabaseConnection;
  private readonly trackedState: RegistryDatabaseState = { statements: [], closed: false };

  constructor(
    readonly root: string,
    private readonly fileDriver: RegistryFileDriver,
    DatabaseDriver: RegistryDatabaseConstructor,
  ) {
    this.fileDriver.mkdirSync(root, { recursive: true });
    this.db = new DatabaseDriver(join(root, "registry.sqlite"), { create: true, strict: true });
    try {
      this.exec("PRAGMA journal_mode = WAL");
      this.exec("PRAGMA busy_timeout = 5000");
      this.exec("PRAGMA foreign_keys = ON");
      this.createSchema();
      this.exec("PRAGMA user_version = 4");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  static create(root: string): RegistryDatabase {
    return new RegistryDatabase(
      root,
      { mkdirSync },
      Database as unknown as RegistryDatabaseConstructor,
    );
  }

  static createNull(root = "/null/worker-agent"): RegistryDatabase {
    class EmbeddedDatabaseStub implements RegistryDatabaseConnection {
      exec(_sql: string): void {}
      query(_sql: string): RegistryStatement {
        return {
          run: () => {},
          get: () => undefined,
          all: () => [],
        };
      }
      transaction<T>(work: () => T): () => T { return work; }
      close(): void {}
    }
    return new RegistryDatabase(
      root,
      { mkdirSync: () => {} },
      EmbeddedDatabaseStub,
    );
  }

  get state(): RegistryDatabaseState {
    return structuredClone(this.trackedState);
  }

  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  close(): void {
    this.db.close();
    this.trackedState.closed = true;
  }

  private exec(sql: string): void {
    this.trackedState.statements.push(sql);
    this.db.exec(sql);
  }

  private createSchema(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rootDir TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastUsedAt TEXT NOT NULL,
        authorizedAt TEXT,
        authorizedBySessionId TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        directoryName TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        createdAt TEXT NOT NULL,
        lastUsedAt TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspaceId TEXT REFERENCES workspaces(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        createdAt TEXT NOT NULL,
        finishedAt TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS projects_tasks (
        projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        addedAt TEXT NOT NULL,
        PRIMARY KEY (projectId, taskId)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        jobType TEXT NOT NULL,
        parentSessionId TEXT NOT NULL,
        parentSessionFile TEXT,
        harness TEXT NOT NULL,
        model TEXT NOT NULL,
        effortLevel TEXT NOT NULL,
        modelName TEXT NOT NULL,
        modelVersion TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('blocked', 'queued', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
        progress TEXT,
        createdAt TEXT NOT NULL,
        finishedAt TEXT,
        bundlePath TEXT NOT NULL,
        userNotified INTEGER NOT NULL DEFAULT 0 CHECK (userNotified IN (0, 1)),
        agentNotified INTEGER NOT NULL DEFAULT 0 CHECK (agentNotified IN (0, 1))
      ) STRICT;

      CREATE TABLE IF NOT EXISTS workerSessions (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
        harnessSessionId TEXT,
        harnessSessionPath TEXT,
        storagePath TEXT NOT NULL,
        createdAt TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS jobDependencies (
        jobId TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        dependsOnJobId TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        relationship TEXT NOT NULL,
        PRIMARY KEY (jobId, dependsOnJobId),
        CHECK (jobId <> dependsOnJobId)
      ) STRICT;

      DROP INDEX IF EXISTS tasks_project_created;
      CREATE INDEX IF NOT EXISTS tasks_workspace_created ON tasks(workspaceId, createdAt DESC);
      CREATE INDEX IF NOT EXISTS projects_tasks_task ON projects_tasks(taskId);
      CREATE INDEX IF NOT EXISTS jobs_task_created ON jobs(taskId, createdAt);
      CREATE INDEX IF NOT EXISTS jobs_parent_created ON jobs(parentSessionId, createdAt DESC);
      CREATE INDEX IF NOT EXISTS dependencies_parent ON jobDependencies(dependsOnJobId);
    `);
  }

}
