import type { AgentProfile } from "../domain/agent-profile.ts";
import { parseAgentProfileOptions } from "../domain/agent-profile.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface AgentProfileRow extends Omit<AgentProfile, "retired"> { retired: number; }
interface Persistence {
  create(profile: AgentProfile): void;
  get(id: string): AgentProfile | undefined;
  list(): AgentProfile[];
  updateDescription(id: string, description: string | null, updatedAt: string): void;
  updateExecution(id: string, harness: AgentProfile["harness"], model: string, options: string, updatedAt: string): void;
  updateRetirement(id: string, retired: boolean, archiveDate: string | null, updatedAt: string): void;
}

/** INFRASTRUCTURE_CONSUMER: persists the manager-configured `agentProfiles` catalog. */
export class AgentProfileRepository {
  constructor(private readonly persistence: Persistence) {}

  static create(database: RegistryDatabase): AgentProfileRepository {
    return new AgentProfileRepository({
      create: (profile) => database.db.query(`INSERT INTO agentProfiles
        (id, description, harness, model, options, retired, archiveDate, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(profile.id, profile.description, profile.harness, profile.model, profile.options, Number(profile.retired), profile.archiveDate, profile.createdAt, profile.updatedAt),
      get: (id) => map(database.db.query("SELECT * FROM agentProfiles WHERE id = ?").get(id) as AgentProfileRow | null),
      list: () => (database.db.query("SELECT * FROM agentProfiles ORDER BY id").all() as AgentProfileRow[]).map(required),
      updateDescription: (id, description, updatedAt) => { database.db.query("UPDATE agentProfiles SET description = ?, updatedAt = ? WHERE id = ?").run(description, updatedAt, id); },
      updateExecution: (id, harness, model, options, updatedAt) => { database.db.query("UPDATE agentProfiles SET harness = ?, model = ?, options = ?, updatedAt = ? WHERE id = ?").run(harness, model, options, updatedAt, id); },
      updateRetirement: (id, retired, archiveDate, updatedAt) => { database.db.query("UPDATE agentProfiles SET retired = ?, archiveDate = ?, updatedAt = ? WHERE id = ?").run(Number(retired), archiveDate, updatedAt, id); },
    });
  }

  static createNull(profiles: AgentProfile[] = []): AgentProfileRepository {
    const records = new Map(profiles.map((profile) => [profile.id, structuredClone(profile)]));
    return new AgentProfileRepository({
      create: (profile) => { if (records.has(profile.id)) throw new Error(`Duplicate agent profile: ${profile.id}`); records.set(profile.id, structuredClone(profile)); },
      get: (id) => clone(records.get(id)),
      list: () => [...records.values()].map((profile) => structuredClone(profile)).sort((a, b) => a.id.localeCompare(b.id)),
      updateDescription: (id, description, updatedAt) => { const value = records.get(id); if (value) Object.assign(value, { description, updatedAt }); },
      updateExecution: (id, harness, model, options, updatedAt) => { const value = records.get(id); if (value) Object.assign(value, { harness, model, options, updatedAt }); },
      updateRetirement: (id, retired, archiveDate, updatedAt) => { const value = records.get(id); if (value) Object.assign(value, { retired, archiveDate, updatedAt }); },
    });
  }

  create(profile: AgentProfile): void { validate(profile); this.persistence.create(profile); }
  get(id: string): AgentProfile | undefined { const value = this.persistence.get(id); if (value) validate(value); return value; }
  list(): AgentProfile[] { const values = this.persistence.list(); values.forEach(validate); return values; }
  updateDescription(id: string, description: string | null, updatedAt: string): void { this.require(id); this.persistence.updateDescription(id, description, updatedAt); }
  updateExecution(id: string, harness: AgentProfile["harness"], model: string, options: string, updatedAt: string): void { this.require(id); this.persistence.updateExecution(id, harness, model, options, updatedAt); }
  updateRetirement(id: string, retired: boolean, archiveDate: string | null, updatedAt: string): void { this.require(id); this.persistence.updateRetirement(id, retired, archiveDate, updatedAt); }
  private require(id: string): AgentProfile { const value = this.get(id); if (!value) throw new Error(`Unknown agent profile: ${id}`); return value; }
}

function validate(profile: AgentProfile): void {
  if (!profile.id.trim() || !profile.model.trim()) throw new Error("Agent profile id and model are required");
  if (profile.harness !== "pi" && profile.harness !== "cursor-agent") throw new Error(`Unknown harness: ${profile.harness}`);
  parseAgentProfileOptions(profile.options);
  if (profile.retired !== Boolean(profile.archiveDate)) throw new Error(`Agent profile ${profile.id} has inconsistent retirement metadata`);
}
function required(row: AgentProfileRow): AgentProfile { const value = map(row); if (!value) throw new Error("Missing agent profile row"); return value; }
function map(row: AgentProfileRow | null): AgentProfile | undefined { return row ? { ...row, retired: Boolean(row.retired) } : undefined; }
function clone<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }
