import type { JobTypeConfiguration, WorktreeStrategy } from "../domain/job-type.ts";
import type { CapabilityProfile } from "../domain/execution-profile.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface JobTypeRow extends Omit<JobTypeConfiguration, "retired"> { retired: number; }
interface Persistence {
  create(jobType: JobTypeConfiguration): void;
  get(id: string): JobTypeConfiguration | undefined;
  list(): JobTypeConfiguration[];
  updateDescription(id: string, description: string | null, updatedAt: string): void;
  updateConfiguration(id: string, capabilityProfile: CapabilityProfile, worktreeStrategy: WorktreeStrategy, agentProfileId: string, updatedAt: string): void;
  updateDefault(id: string, agentProfileId: string, updatedAt: string): void;
  updateRetirement(id: string, retired: boolean, archiveDate: string | null, updatedAt: string): void;
}

/** INFRASTRUCTURE_CONSUMER: persists the manager-configured `jobTypes` catalog. */
export class JobTypeRepository {
  constructor(private readonly persistence: Persistence) {}

  static create(database: RegistryDatabase): JobTypeRepository {
    return new JobTypeRepository({
      create: (value) => database.db.query(`INSERT INTO jobTypes
        (id, description, capabilityProfile, worktreeStrategy, defaultAgentProfileId, retired, archiveDate, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(value.id, value.description, value.capabilityProfile, value.worktreeStrategy, value.defaultAgentProfileId, Number(value.retired), value.archiveDate, value.createdAt, value.updatedAt),
      get: (id) => map(database.db.query("SELECT * FROM jobTypes WHERE id = ?").get(id) as JobTypeRow | null),
      list: () => (database.db.query("SELECT * FROM jobTypes ORDER BY id").all() as JobTypeRow[]).map(required),
      updateDescription: (id, description, updatedAt) => { database.db.query("UPDATE jobTypes SET description = ?, updatedAt = ? WHERE id = ?").run(description, updatedAt, id); },
      updateConfiguration: (id, capability, strategy, profileId, updatedAt) => { database.db.query("UPDATE jobTypes SET capabilityProfile = ?, worktreeStrategy = ?, defaultAgentProfileId = ?, updatedAt = ? WHERE id = ?").run(capability, strategy, profileId, updatedAt, id); },
      updateDefault: (id, profileId, updatedAt) => { database.db.query("UPDATE jobTypes SET defaultAgentProfileId = ?, updatedAt = ? WHERE id = ?").run(profileId, updatedAt, id); },
      updateRetirement: (id, retired, archiveDate, updatedAt) => { database.db.query("UPDATE jobTypes SET retired = ?, archiveDate = ?, updatedAt = ? WHERE id = ?").run(Number(retired), archiveDate, updatedAt, id); },
    });
  }

  static createNull(values: JobTypeConfiguration[] = []): JobTypeRepository {
    const records = new Map(values.map((value) => [value.id, structuredClone(value)]));
    return new JobTypeRepository({
      create: (value) => { if (records.has(value.id)) throw new Error(`Duplicate job type: ${value.id}`); records.set(value.id, structuredClone(value)); },
      get: (id) => clone(records.get(id)),
      list: () => [...records.values()].map((value) => structuredClone(value)).sort((a, b) => a.id.localeCompare(b.id)),
      updateDescription: (id, description, updatedAt) => { const value = records.get(id); if (value) Object.assign(value, { description, updatedAt }); },
      updateConfiguration: (id, capabilityProfile, worktreeStrategy, defaultAgentProfileId, updatedAt) => { const value = records.get(id); if (value) Object.assign(value, { capabilityProfile, worktreeStrategy, defaultAgentProfileId, updatedAt }); },
      updateDefault: (id, defaultAgentProfileId, updatedAt) => { const value = records.get(id); if (value) Object.assign(value, { defaultAgentProfileId, updatedAt }); },
      updateRetirement: (id, retired, archiveDate, updatedAt) => { const value = records.get(id); if (value) Object.assign(value, { retired, archiveDate, updatedAt }); },
    });
  }

  create(value: JobTypeConfiguration): void { validate(value); this.persistence.create(value); }
  get(id: string): JobTypeConfiguration | undefined { const value = this.persistence.get(id); if (value) validate(value); return value; }
  list(): JobTypeConfiguration[] { const values = this.persistence.list(); values.forEach(validate); return values; }
  updateDescription(id: string, description: string | null, updatedAt: string): void { this.require(id); this.persistence.updateDescription(id, description, updatedAt); }
  updateConfiguration(id: string, capabilityProfile: CapabilityProfile, worktreeStrategy: WorktreeStrategy, profileId: string, updatedAt: string): void { this.require(id); this.persistence.updateConfiguration(id, capabilityProfile, worktreeStrategy, profileId, updatedAt); }
  updateDefault(id: string, profileId: string, updatedAt: string): void { this.require(id); this.persistence.updateDefault(id, profileId, updatedAt); }
  updateRetirement(id: string, retired: boolean, archiveDate: string | null, updatedAt: string): void { this.require(id); this.persistence.updateRetirement(id, retired, archiveDate, updatedAt); }
  private require(id: string): JobTypeConfiguration { const value = this.get(id); if (!value) throw new Error(`Unknown job type: ${id}`); return value; }
}

const CAPABILITIES: readonly CapabilityProfile[] = ["read-only", "code", "test"];
const STRATEGIES: readonly WorktreeStrategy[] = ["workspace", "new-worktree", "dependency-worktree"];
function validate(value: JobTypeConfiguration): void {
  if (!value.id.trim() || !value.defaultAgentProfileId.trim()) throw new Error("Job type id and default agent profile are required");
  if (!CAPABILITIES.includes(value.capabilityProfile)) throw new Error(`Invalid capability profile: ${value.capabilityProfile}`);
  if (!STRATEGIES.includes(value.worktreeStrategy)) throw new Error(`Invalid worktree strategy: ${value.worktreeStrategy}`);
  if (value.retired !== Boolean(value.archiveDate)) throw new Error(`Job type ${value.id} has inconsistent retirement metadata`);
}
function required(row: JobTypeRow): JobTypeConfiguration { const value = map(row); if (!value) throw new Error("Missing job type row"); return value; }
function map(row: JobTypeRow | null): JobTypeConfiguration | undefined { return row ? { ...row, retired: Boolean(row.retired) } : undefined; }
function clone<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }
