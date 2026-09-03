import type { TaskAgentProfileOverride } from "../domain/task-agent-profile-override.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface Persistence {
  set(value: TaskAgentProfileOverride): void;
  get(taskId: string, jobTypeId: string): TaskAgentProfileOverride | undefined;
  listForTask(taskId: string): TaskAgentProfileOverride[];
  delete(taskId: string, jobTypeId: string): void;
}

/** INFRASTRUCTURE_CONSUMER: persists task-local agent choices by job type. */
export class TaskAgentProfileOverrideRepository {
  constructor(private readonly persistence: Persistence) {}

  static create(database: RegistryDatabase): TaskAgentProfileOverrideRepository {
    return new TaskAgentProfileOverrideRepository({
      set: (value) => database.db.query(`INSERT INTO taskAgentProfileOverrides (taskId, jobTypeId, agentProfileId)
        VALUES (?, ?, ?) ON CONFLICT(taskId, jobTypeId) DO UPDATE SET agentProfileId = excluded.agentProfileId`)
        .run(value.taskId, value.jobTypeId, value.agentProfileId),
      get: (taskId, jobTypeId) => database.db.query("SELECT * FROM taskAgentProfileOverrides WHERE taskId = ? AND jobTypeId = ?").get(taskId, jobTypeId) as TaskAgentProfileOverride | undefined,
      listForTask: (taskId) => database.db.query("SELECT * FROM taskAgentProfileOverrides WHERE taskId = ? ORDER BY jobTypeId").all(taskId) as TaskAgentProfileOverride[],
      delete: (taskId, jobTypeId) => { database.db.query("DELETE FROM taskAgentProfileOverrides WHERE taskId = ? AND jobTypeId = ?").run(taskId, jobTypeId); },
    });
  }

  static createNull(values: TaskAgentProfileOverride[] = []): TaskAgentProfileOverrideRepository {
    const records = new Map(values.map((value) => [`${value.taskId}\0${value.jobTypeId}`, structuredClone(value)]));
    return new TaskAgentProfileOverrideRepository({
      set: (value) => records.set(`${value.taskId}\0${value.jobTypeId}`, structuredClone(value)),
      get: (taskId, jobTypeId) => clone(records.get(`${taskId}\0${jobTypeId}`)),
      listForTask: (taskId) => [...records.values()].filter((value) => value.taskId === taskId).map((value) => structuredClone(value)).sort((a, b) => a.jobTypeId.localeCompare(b.jobTypeId)),
      delete: (taskId, jobTypeId) => { records.delete(`${taskId}\0${jobTypeId}`); },
    });
  }

  set(value: TaskAgentProfileOverride): void { this.persistence.set(value); }
  get(taskId: string, jobTypeId: string): TaskAgentProfileOverride | undefined { return this.persistence.get(taskId, jobTypeId); }
  listForTask(taskId: string): TaskAgentProfileOverride[] { return this.persistence.listForTask(taskId); }
  delete(taskId: string, jobTypeId: string): void { this.persistence.delete(taskId, jobTypeId); }
}
function clone<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }
