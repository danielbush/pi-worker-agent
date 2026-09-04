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
type RegistryDatabaseConstructor = new (path: string, options: { create: boolean; strict: boolean }) => RegistryDatabaseConnection;
interface RegistryFileDriver { mkdirSync(path: string, options: { recursive: boolean }): unknown; }
export interface RegistryDatabaseState { statements: string[]; closed: boolean; }

/** INFRASTRUCTURE_WRAPPER: owns SQLite connection, schema, migrations, and transactions. */
export class RegistryDatabase {
  readonly db: RegistryDatabaseConnection;
  private readonly trackedState: RegistryDatabaseState = { statements: [], closed: false };

  constructor(readonly root: string, private readonly fileDriver: RegistryFileDriver, DatabaseDriver: RegistryDatabaseConstructor) {
    this.fileDriver.mkdirSync(root, { recursive: true });
    this.db = new DatabaseDriver(join(root, "registry.sqlite"), { create: true, strict: true });
    try {
      this.exec("PRAGMA journal_mode = WAL");
      this.exec("PRAGMA busy_timeout = 5000");
      this.exec("PRAGMA foreign_keys = ON");
      const version = Number((this.db.query("PRAGMA user_version").get() as { user_version?: number } | null)?.user_version ?? 0);
      this.createSchema();
      if (version > 0 && version < 5) this.migrateToExecutionProfiles();
      if (version > 0 && version < 6) this.migrateExecutionSnapshotProvenance();
      if (version > 0 && version < 7) this.migrateProfileOptions();
      if (version > 0 && version < 8) this.migrateExecutionCatalogs();
      if (version > 0 && version < 9) this.migrateTaskOverridesToExplicitJobAssignments();
      if (version > 0 && version < 10) this.migrateProjectCollections();
      this.createIndexes();
      this.createCatalogGuards();
      this.createExecutionSnapshotGuards();
      this.exec("PRAGMA user_version = 10");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  static create(root: string): RegistryDatabase {
    return new RegistryDatabase(root, { mkdirSync }, Database as unknown as RegistryDatabaseConstructor);
  }
  static createNull(root = "/null/worker-agent"): RegistryDatabase {
    class EmbeddedDatabaseStub implements RegistryDatabaseConnection {
      exec(_sql: string): void {}
      query(_sql: string): RegistryStatement { return { run: () => {}, get: () => undefined, all: () => [] }; }
      transaction<T>(work: () => T): () => T { return work; }
      close(): void {}
    }
    return new RegistryDatabase(root, { mkdirSync: () => {} }, EmbeddedDatabaseStub);
  }

  get state(): RegistryDatabaseState { return structuredClone(this.trackedState); }
  transaction<T>(work: () => T): T { return this.db.transaction(work)(); }
  close(): void { this.db.close(); this.trackedState.closed = true; }
  private exec(sql: string): void { this.trackedState.statements.push(sql); this.db.exec(sql); }

  private createSchema(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, rootDir TEXT NOT NULL,
        createdAt TEXT NOT NULL, lastUsedAt TEXT NOT NULL,
        authorizedAt TEXT, authorizedBySessionId TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        collection TEXT NOT NULL DEFAULT 'active' CHECK (collection IN ('active', 'test', 'archive')),
        directoryName TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        description TEXT, createdAt TEXT NOT NULL, lastUsedAt TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agentProfiles (
        id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
        description TEXT,
        harness TEXT NOT NULL CHECK (harness IN ('pi', 'cursor-agent')),
        model TEXT NOT NULL CHECK (length(trim(model)) > 0),
        options TEXT NOT NULL CHECK (json_valid(options) AND json_type(options) = 'object'),
        retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)),
        archiveDate TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        CHECK ((retired = 0 AND archiveDate IS NULL) OR (retired = 1 AND archiveDate IS NOT NULL AND length(trim(archiveDate)) > 0))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS jobTypes (
        id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
        description TEXT,
        capabilityProfile TEXT NOT NULL CHECK (capabilityProfile IN ('read-only', 'code', 'test')),
        worktreeStrategy TEXT NOT NULL CHECK (worktreeStrategy IN ('workspace', 'new-worktree', 'dependency-worktree')),
        defaultAgentProfileId TEXT NOT NULL REFERENCES agentProfiles(id),
        retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)),
        archiveDate TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        CHECK ((retired = 0 AND archiveDate IS NULL) OR (retired = 1 AND archiveDate IS NOT NULL AND length(trim(archiveDate)) > 0))
      ) STRICT;
    `);
    this.createTasksTable("tasks");
    this.exec(`
      CREATE TABLE IF NOT EXISTS projects_tasks (
        projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        addedAt TEXT NOT NULL,
        PRIMARY KEY (projectId, taskId)
      ) STRICT;
    `);
    this.createJobsTable("jobs");
    this.exec(`
      CREATE TABLE IF NOT EXISTS workerSessions (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
        harnessSessionId TEXT, harnessSessionPath TEXT,
        storagePath TEXT NOT NULL, createdAt TEXT NOT NULL
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

  private createTasksTable(name: string): void {
    this.exec(`CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY,
      workspaceId TEXT REFERENCES workspaces(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      createdAt TEXT NOT NULL,
      finishedAt TEXT
    ) STRICT;`);
  }

  private createJobsTable(name: string): void {
    this.exec(`CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      jobTypeId TEXT NOT NULL REFERENCES jobTypes(id),
      agentProfileId TEXT NOT NULL REFERENCES agentProfiles(id),
      agentProfileSelectionSource TEXT NOT NULL CHECK (agentProfileSelectionSource IN ('job-type-default', 'explicit', 'migration-fossil')),
      parentSessionId TEXT NOT NULL,
      parentSessionFile TEXT,
      snapshotProvenance TEXT NOT NULL CHECK (snapshotProvenance IN ('current', 'migration-fossil')),
      profileFingerprint TEXT,
      profileOptions TEXT CHECK (profileOptions IS NULL OR (json_valid(profileOptions) AND json_type(profileOptions) = 'object')),
      capabilityProfile TEXT,
      harness TEXT NOT NULL CHECK (harness IN ('pi', 'cursor-agent')),
      harnessVersion TEXT,
      nativeInvocation TEXT CHECK (nativeInvocation IS NULL OR (json_valid(nativeInvocation) AND json_type(nativeInvocation) = 'object')),
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
      agentNotified INTEGER NOT NULL DEFAULT 0 CHECK (agentNotified IN (0, 1)),
      CHECK (
        (snapshotProvenance = 'migration-fossil' AND profileFingerprint IS NULL AND profileOptions IS NULL AND capabilityProfile IS NULL AND harnessVersion IS NULL AND nativeInvocation IS NULL)
        OR
        (snapshotProvenance = 'current' AND profileFingerprint IS NOT NULL AND profileOptions IS NOT NULL AND capabilityProfile IS NOT NULL AND harnessVersion IS NOT NULL AND nativeInvocation IS NOT NULL)
      ),
      CHECK (capabilityProfile IS NULL OR capabilityProfile IN ('read-only', 'code', 'test'))
    ) STRICT;`);
  }

  private migrateToExecutionProfiles(): void {
    this.exec("ALTER TABLE tasks ADD COLUMN profileOverrides TEXT");
    this.exec("ALTER TABLE jobs ADD COLUMN workerProfile TEXT");
    this.exec("ALTER TABLE jobs ADD COLUMN profileFingerprint TEXT");
    this.exec("ALTER TABLE jobs ADD COLUMN capabilityProfile TEXT");
    this.exec("ALTER TABLE jobs ADD COLUMN harnessVersion TEXT");
    this.exec("ALTER TABLE jobs ADD COLUMN nativeInvocation TEXT");
  }
  private migrateExecutionSnapshotProvenance(): void {
    const malformed = this.db.query(`SELECT id FROM jobs WHERE NOT (
      (workerProfile IS NULL AND profileFingerprint IS NULL AND capabilityProfile IS NULL AND harnessVersion IS NULL AND nativeInvocation IS NULL)
      OR (workerProfile IS NOT NULL AND profileFingerprint IS NOT NULL AND capabilityProfile IS NOT NULL AND harnessVersion IS NOT NULL AND nativeInvocation IS NOT NULL)
    ) LIMIT 1`).get() as { id?: string } | null;
    if (malformed?.id) throw new Error(`Cannot migrate partial execution snapshot for job ${malformed.id}`);
    this.exec("ALTER TABLE jobs ADD COLUMN snapshotProvenance TEXT");
    this.exec("UPDATE jobs SET snapshotProvenance = CASE WHEN workerProfile IS NULL THEN 'migration-fossil' ELSE 'current' END");
  }
  private migrateProfileOptions(): void {
    this.exec("ALTER TABLE jobs ADD COLUMN profileOptions TEXT");
    this.exec(`UPDATE jobs SET profileOptions = CASE
      WHEN snapshotProvenance = 'migration-fossil' THEN NULL
      WHEN harness = 'pi' THEN json_object('thinking', effortLevel)
      ELSE json('{}') END`);
  }

  private migrateExecutionCatalogs(): void {
    this.exec(`CREATE TABLE IF NOT EXISTS taskAgentProfileOverrides (
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      jobTypeId TEXT NOT NULL REFERENCES jobTypes(id),
      agentProfileId TEXT NOT NULL REFERENCES agentProfiles(id),
      PRIMARY KEY (taskId, jobTypeId)
    ) STRICT;`);
    const conflict = this.db.query(`SELECT workerProfile AS id FROM jobs
      WHERE snapshotProvenance = 'current'
      GROUP BY workerProfile HAVING count(DISTINCT profileFingerprint) > 1 LIMIT 1`).get() as { id?: string } | null;
    if (conflict?.id) throw new Error(`Cannot migrate changing agent profile identity: ${conflict.id}`);
    const badOverride = this.db.query(`SELECT tasks.id FROM tasks, json_each(tasks.profileOverrides)
      WHERE tasks.profileOverrides IS NOT NULL AND (length(trim(json_each.key)) = 0 OR json_each.type <> 'text' OR length(trim(json_each.value)) = 0)
      LIMIT 1`).get() as { id?: string } | null;
    if (badOverride?.id) throw new Error(`Cannot migrate malformed task profile override: ${badOverride.id}`);
    const now = new Date().toISOString();
    this.db.query(`INSERT OR IGNORE INTO agentProfiles
      (id, description, harness, model, options, retired, archiveDate, createdAt, updatedAt)
      SELECT workerProfile, 'Migrated historical agent profile', harness, model, profileOptions, 1, ?, ?, ?
      FROM jobs WHERE snapshotProvenance = 'current' GROUP BY workerProfile`).run(now, now, now);
    const fossils = (this.db.query("SELECT 1 AS found FROM jobs WHERE snapshotProvenance = 'migration-fossil' LIMIT 1").get() as { found?: number } | null)?.found;
    if (fossils) this.db.query(`INSERT OR IGNORE INTO agentProfiles VALUES
      ('migration-fossil', 'Unresolved historical execution identity', 'pi', 'migration-fossil', '{}', 1, ?, ?, ?)`)
      .run(now, now, now);
    this.db.query(`INSERT OR IGNORE INTO agentProfiles
      (id, description, harness, model, options, retired, archiveDate, createdAt, updatedAt)
      SELECT DISTINCT value, 'Unresolved migrated task override', 'pi', 'migration-unresolved', '{}', 1, ?, ?, ?
      FROM tasks, json_each(tasks.profileOverrides)
      WHERE tasks.profileOverrides IS NOT NULL`).run(now, now, now);
    // Legacy migration only: reconstruct the pre-catalog built-in names once; runtime never interprets job-type IDs.
    this.db.query(`INSERT OR IGNORE INTO jobTypes
      (id, description, capabilityProfile, worktreeStrategy, defaultAgentProfileId, retired, archiveDate, createdAt, updatedAt)
      SELECT DISTINCT j.jobType, 'Migrated historical job type',
        CASE j.jobType WHEN 'implement' THEN 'code' WHEN 'fix' THEN 'code' WHEN 'test' THEN 'test' ELSE 'read-only' END,
        CASE j.jobType WHEN 'implement' THEN 'new-worktree' WHEN 'fix' THEN 'dependency-worktree' WHEN 'review' THEN 'dependency-worktree' WHEN 'test' THEN 'dependency-worktree' ELSE 'workspace' END,
        COALESCE((SELECT j2.workerProfile FROM jobs j2 WHERE j2.jobType = j.jobType AND j2.workerProfile IS NOT NULL ORDER BY j2.createdAt DESC LIMIT 1), 'migration-fossil'),
        1, ?, ?, ? FROM jobs j`).run(now, now, now);
    this.db.query(`INSERT OR IGNORE INTO jobTypes
      (id, description, capabilityProfile, worktreeStrategy, defaultAgentProfileId, retired, archiveDate, createdAt, updatedAt)
      SELECT DISTINCT json_each.key, 'Migrated task-override job type',
        CASE json_each.key WHEN 'implement' THEN 'code' WHEN 'fix' THEN 'code' WHEN 'test' THEN 'test' ELSE 'read-only' END,
        CASE json_each.key WHEN 'implement' THEN 'new-worktree' WHEN 'fix' THEN 'dependency-worktree' WHEN 'review' THEN 'dependency-worktree' WHEN 'test' THEN 'dependency-worktree' ELSE 'workspace' END,
        json_each.value, 1, ?, ?, ? FROM tasks, json_each(tasks.profileOverrides)
      WHERE tasks.profileOverrides IS NOT NULL`).run(now, now, now);
    this.db.query(`INSERT OR REPLACE INTO taskAgentProfileOverrides (taskId, jobTypeId, agentProfileId)
      SELECT tasks.id, json_each.key, json_each.value FROM tasks, json_each(tasks.profileOverrides)
      WHERE tasks.profileOverrides IS NOT NULL
        AND EXISTS (SELECT 1 FROM jobTypes WHERE jobTypes.id = json_each.key)`).run();

    this.exec("PRAGMA foreign_keys = OFF");
    this.exec("PRAGMA legacy_alter_table = ON");
    this.exec("ALTER TABLE tasks RENAME TO tasks_v7");
    this.exec("ALTER TABLE jobs RENAME TO jobs_v7");
    this.createTasksTable("tasks");
    this.createJobsTable("jobs");
    this.exec(`INSERT INTO tasks (id, workspaceId, title, status, createdAt, finishedAt)
      SELECT id, workspaceId, title, status, createdAt, finishedAt FROM tasks_v7`);
    this.exec(`INSERT INTO jobs (
      id, taskId, jobTypeId, agentProfileId, agentProfileSelectionSource,
      parentSessionId, parentSessionFile, snapshotProvenance, profileFingerprint, profileOptions,
      capabilityProfile, harness, harnessVersion, nativeInvocation, model, effortLevel, modelName,
      modelVersion, title, status, progress, createdAt, finishedAt, bundlePath, userNotified, agentNotified
    ) SELECT id, taskId, jobType,
      CASE WHEN snapshotProvenance = 'current' THEN workerProfile ELSE 'migration-fossil' END,
      'migration-fossil', parentSessionId, parentSessionFile, snapshotProvenance, profileFingerprint,
      profileOptions, capabilityProfile, harness, harnessVersion, nativeInvocation, model, effortLevel,
      modelName, modelVersion, title, status, progress, createdAt, finishedAt, bundlePath,
      userNotified, agentNotified FROM jobs_v7`);
    this.exec("DROP TABLE jobs_v7");
    this.exec("DROP TABLE tasks_v7");
    this.exec("PRAGMA legacy_alter_table = OFF");
    const broken = this.db.query("PRAGMA foreign_key_check").get() as { table?: string } | null;
    if (broken?.table) throw new Error(`Execution catalog migration broke a foreign key in ${broken.table}`);
    this.exec("PRAGMA foreign_keys = ON");
  }

  private migrateTaskOverridesToExplicitJobAssignments(): void {
    this.exec("PRAGMA foreign_keys = OFF");
    this.exec("PRAGMA legacy_alter_table = ON");
    this.exec("ALTER TABLE jobs RENAME TO jobs_v8");
    this.createJobsTable("jobs");
    this.exec(`INSERT INTO jobs (
      id, taskId, jobTypeId, agentProfileId, agentProfileSelectionSource,
      parentSessionId, parentSessionFile, snapshotProvenance, profileFingerprint, profileOptions,
      capabilityProfile, harness, harnessVersion, nativeInvocation, model, effortLevel, modelName,
      modelVersion, title, status, progress, createdAt, finishedAt, bundlePath, userNotified, agentNotified
    ) SELECT id, taskId, jobTypeId, agentProfileId,
      CASE agentProfileSelectionSource WHEN 'task-override' THEN 'explicit' ELSE agentProfileSelectionSource END,
      parentSessionId, parentSessionFile, snapshotProvenance, profileFingerprint, profileOptions,
      capabilityProfile, harness, harnessVersion, nativeInvocation, model, effortLevel, modelName,
      modelVersion, title, status, progress, createdAt, finishedAt, bundlePath, userNotified, agentNotified
      FROM jobs_v8`);
    this.exec("DROP TABLE jobs_v8");
    this.exec("DROP TABLE IF EXISTS taskAgentProfileOverrides");
    this.exec("PRAGMA legacy_alter_table = OFF");
    const broken = this.db.query("PRAGMA foreign_key_check").get() as { table?: string } | null;
    if (broken?.table) throw new Error(`Task override removal broke a foreign key in ${broken.table}`);
    this.exec("PRAGMA foreign_keys = ON");
  }

  private migrateProjectCollections(): void {
    const columns = this.db.query("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "collection")) {
      this.exec("ALTER TABLE projects ADD COLUMN collection TEXT NOT NULL DEFAULT 'active' CHECK (collection IN ('active', 'test', 'archive'))");
    }
  }

  private createIndexes(): void {
    this.exec(`
      CREATE INDEX IF NOT EXISTS tasks_workspace_created ON tasks(workspaceId, createdAt DESC);
      CREATE INDEX IF NOT EXISTS projects_tasks_task ON projects_tasks(taskId);
      CREATE INDEX IF NOT EXISTS jobs_task_created ON jobs(taskId, createdAt);
      CREATE INDEX IF NOT EXISTS jobs_parent_created ON jobs(parentSessionId, createdAt DESC);
      CREATE INDEX IF NOT EXISTS dependencies_parent ON jobDependencies(dependsOnJobId);
    `);
  }

  private createCatalogGuards(): void {
    this.exec(`
      DROP TRIGGER IF EXISTS agent_profiles_string_options_insert;
      CREATE TRIGGER agent_profiles_string_options_insert BEFORE INSERT ON agentProfiles
      WHEN EXISTS (SELECT 1 FROM json_each(NEW.options) WHERE type <> 'text')
      BEGIN SELECT RAISE(ABORT, 'agent profile options must contain only strings'); END;

      DROP TRIGGER IF EXISTS agent_profiles_string_options_update;
      CREATE TRIGGER agent_profiles_string_options_update BEFORE UPDATE OF options ON agentProfiles
      WHEN EXISTS (SELECT 1 FROM json_each(NEW.options) WHERE type <> 'text')
      BEGIN SELECT RAISE(ABORT, 'agent profile options must contain only strings'); END;

      DROP TRIGGER IF EXISTS agent_profiles_immutable_execution;
      CREATE TRIGGER agent_profiles_immutable_execution
      BEFORE UPDATE OF harness, model, options ON agentProfiles
      WHEN EXISTS (SELECT 1 FROM jobs WHERE agentProfileId = OLD.id)
        OR EXISTS (SELECT 1 FROM jobTypes WHERE defaultAgentProfileId = OLD.id)
      BEGIN SELECT RAISE(ABORT, 'referenced agent profile execution fields are immutable'); END;

      DROP TRIGGER IF EXISTS agent_profiles_retire_active_default;
      CREATE TRIGGER agent_profiles_retire_active_default
      BEFORE UPDATE OF retired ON agentProfiles WHEN NEW.retired = 1
        AND EXISTS (SELECT 1 FROM jobTypes WHERE defaultAgentProfileId = OLD.id AND retired = 0)
      BEGIN SELECT RAISE(ABORT, 'agent profile is an active job type default'); END;

      DROP TRIGGER IF EXISTS job_types_active_default_insert;
      CREATE TRIGGER job_types_active_default_insert
      BEFORE INSERT ON jobTypes WHEN NEW.retired = 0
        AND NOT EXISTS (SELECT 1 FROM agentProfiles WHERE id = NEW.defaultAgentProfileId AND retired = 0)
      BEGIN SELECT RAISE(ABORT, 'active job type requires an active default agent profile'); END;

      DROP TRIGGER IF EXISTS job_types_active_default_update;
      CREATE TRIGGER job_types_active_default_update
      BEFORE UPDATE OF defaultAgentProfileId, retired ON jobTypes WHEN NEW.retired = 0
        AND NOT EXISTS (SELECT 1 FROM agentProfiles WHERE id = NEW.defaultAgentProfileId AND retired = 0)
      BEGIN SELECT RAISE(ABORT, 'active job type requires an active default agent profile'); END;

      DROP TRIGGER IF EXISTS job_types_immutable_execution;
      DROP TRIGGER IF EXISTS job_types_active_execution;
      CREATE TRIGGER job_types_active_execution
      BEFORE UPDATE OF capabilityProfile, worktreeStrategy ON jobTypes
      WHEN EXISTS (
        SELECT 1 FROM jobs
        WHERE jobTypeId = OLD.id AND status IN ('blocked', 'queued', 'running')
      )
      BEGIN SELECT RAISE(ABORT, 'job type execution settings cannot change while it has active jobs'); END;

      DROP TRIGGER IF EXISTS jobs_active_assignment_insert;
      CREATE TRIGGER jobs_active_assignment_insert BEFORE INSERT ON jobs
      WHEN NOT EXISTS (SELECT 1 FROM jobTypes WHERE id = NEW.jobTypeId AND retired = 0 AND capabilityProfile = NEW.capabilityProfile)
        OR NOT EXISTS (SELECT 1 FROM agentProfiles WHERE id = NEW.agentProfileId AND retired = 0)
        OR (NEW.agentProfileSelectionSource = 'job-type-default' AND NOT EXISTS (
          SELECT 1 FROM jobTypes WHERE id = NEW.jobTypeId AND defaultAgentProfileId = NEW.agentProfileId
        ))
        OR NEW.agentProfileSelectionSource = 'migration-fossil'
      BEGIN SELECT RAISE(ABORT, 'job assignment requires active binding configuration'); END;

      DROP TRIGGER IF EXISTS jobs_assignment_immutable;
      CREATE TRIGGER jobs_assignment_immutable
      BEFORE UPDATE OF taskId, jobTypeId, agentProfileId, agentProfileSelectionSource ON jobs
      BEGIN SELECT RAISE(ABORT, 'job assignment is immutable'); END;
    `);
  }

  private createExecutionSnapshotGuards(): void {
    const valid = `(
      (NEW.snapshotProvenance = 'migration-fossil' AND NEW.profileFingerprint IS NULL AND NEW.profileOptions IS NULL AND NEW.capabilityProfile IS NULL AND NEW.harnessVersion IS NULL AND NEW.nativeInvocation IS NULL)
      OR
      (NEW.snapshotProvenance = 'current' AND NEW.profileFingerprint IS NOT NULL AND NEW.profileOptions IS NOT NULL AND NEW.capabilityProfile IS NOT NULL AND NEW.harnessVersion IS NOT NULL AND NEW.nativeInvocation IS NOT NULL)
    )`;
    this.exec("DROP TRIGGER IF EXISTS jobs_execution_snapshot_insert");
    this.exec("DROP TRIGGER IF EXISTS jobs_execution_snapshot_update");
    this.exec("DROP TRIGGER IF EXISTS jobs_execution_snapshot_immutable");
    this.exec(`CREATE TRIGGER jobs_execution_snapshot_insert BEFORE INSERT ON jobs WHEN COALESCE(${valid}, 0) = 0
      BEGIN SELECT RAISE(ABORT, 'invalid execution snapshot provenance'); END`);
    this.exec(`CREATE TRIGGER jobs_execution_snapshot_update
      BEFORE UPDATE OF snapshotProvenance, profileFingerprint, profileOptions, capabilityProfile, harnessVersion, nativeInvocation
      ON jobs WHEN COALESCE(${valid}, 0) = 0
      BEGIN SELECT RAISE(ABORT, 'invalid execution snapshot provenance'); END`);
    this.exec(`CREATE TRIGGER jobs_execution_snapshot_immutable
      BEFORE UPDATE OF snapshotProvenance, profileFingerprint, profileOptions, capabilityProfile,
        harness, harnessVersion, nativeInvocation, model, effortLevel, modelName, modelVersion ON jobs
      BEGIN SELECT RAISE(ABORT, 'job execution snapshot is immutable'); END`);
  }
}
