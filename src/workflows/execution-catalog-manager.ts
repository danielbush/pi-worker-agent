import { canonicalAgentProfileOptions, executableAgentProfile, type AgentProfile } from "../domain/agent-profile.ts";
import type { CapabilityProfile, HarnessName } from "../domain/execution-profile.ts";
import type { JobTypeConfiguration, WorktreeStrategy } from "../domain/job-type.ts";
import { Clock } from "../infrastructure/system/clock.ts";
import { Registry } from "../storage/registry.ts";

export interface CreateAgentProfileInput {
  id: string;
  description?: string;
  harness: HarnessName;
  model: string;
  options: Record<string, string>;
}
export interface CreateJobTypeInput {
  id: string;
  description?: string;
  capabilityProfile: CapabilityProfile;
  worktreeStrategy: WorktreeStrategy;
  defaultAgentProfileId: string;
}

/** INFRASTRUCTURE_CONSUMER: manages binding prerequisite execution configuration. */
export class ExecutionCatalogManager {
  constructor(private readonly registry: Registry, private readonly clock: Clock) {}
  static create(registry: Registry): ExecutionCatalogManager { return new ExecutionCatalogManager(registry, Clock.create()); }
  static createNull(registry: Registry = Registry.createNull(), now = "2026-01-01T00:00:00.000Z"): ExecutionCatalogManager {
    return new ExecutionCatalogManager(registry, Clock.createNull(now));
  }

  listAgentProfiles(): AgentProfile[] { return this.registry.agentProfiles.list(); }
  listJobTypes(): JobTypeConfiguration[] { return this.registry.jobTypes.list(); }

  createAgentProfile(input: CreateAgentProfileInput): AgentProfile {
    const now = this.clock.now();
    const profile: AgentProfile = {
      id: requiredId(input.id, "Agent profile"), description: optionalDescription(input.description),
      harness: input.harness, model: input.model.trim(), options: canonicalAgentProfileOptions(input.options),
      retired: false, archiveDate: null, createdAt: now, updatedAt: now,
    };
    validateHarnessOptions(profile);
    this.registry.agentProfiles.create(profile);
    return profile;
  }

  describeAgentProfile(id: string, description?: string): AgentProfile {
    this.registry.agentProfiles.updateDescription(id, optionalDescription(description), this.clock.now());
    return this.requireAgentProfile(id);
  }

  updateAgentProfile(id: string, harness: HarnessName, model: string, options: Record<string, string>): AgentProfile {
    const current = this.requireAgentProfile(id);
    if (this.registry.jobTypes.list().some((value) => value.defaultAgentProfileId === id)
      || this.registry.tasks.list().some((task) => this.registry.jobs.listForTask(task.id).some((job) => job.agentProfileId === id))) {
      throw new Error(`Referenced agent profile execution fields are immutable: ${id}`);
    }
    const candidate = { ...current, harness, model: model.trim(), options: canonicalAgentProfileOptions(options), updatedAt: this.clock.now() };
    validateHarnessOptions(candidate);
    this.registry.agentProfiles.updateExecution(id, candidate.harness, candidate.model, candidate.options, candidate.updatedAt);
    return this.requireAgentProfile(id);
  }

  retireAgentProfile(id: string): AgentProfile {
    const profile = this.requireAgentProfile(id);
    if (profile.retired) return profile;
    const activeDefault = this.registry.jobTypes.list().find((jobType) => !jobType.retired && jobType.defaultAgentProfileId === id);
    if (activeDefault) throw new Error(`Agent profile ${id} is the active default for job type ${activeDefault.id}`);
    const now = this.clock.now();
    this.registry.agentProfiles.updateRetirement(id, true, now, now);
    return this.requireAgentProfile(id);
  }

  reactivateAgentProfile(id: string): AgentProfile {
    const profile = this.requireAgentProfile(id);
    if (!profile.retired) return profile;
    validateHarnessOptions(profile);
    this.registry.agentProfiles.updateRetirement(id, false, null, this.clock.now());
    return this.requireAgentProfile(id);
  }

  createJobType(input: CreateJobTypeInput): JobTypeConfiguration {
    const profile = this.requireActiveAgentProfile(input.defaultAgentProfileId);
    const now = this.clock.now();
    const jobType: JobTypeConfiguration = {
      id: requiredId(input.id, "Job type"), description: optionalDescription(input.description),
      capabilityProfile: input.capabilityProfile, worktreeStrategy: input.worktreeStrategy,
      defaultAgentProfileId: profile.id, retired: false, archiveDate: null, createdAt: now, updatedAt: now,
    };
    this.registry.jobTypes.create(jobType);
    return jobType;
  }

  describeJobType(id: string, description?: string): JobTypeConfiguration {
    this.registry.jobTypes.updateDescription(id, optionalDescription(description), this.clock.now());
    return this.requireJobType(id);
  }

  updateJobType(id: string, capabilityProfile: CapabilityProfile, worktreeStrategy: WorktreeStrategy, defaultAgentProfileId: string): JobTypeConfiguration {
    this.requireJobType(id);
    this.requireActiveAgentProfile(defaultAgentProfileId);
    const activeStatuses = new Set(["blocked", "queued", "running"]);
    if (this.registry.tasks.list().some((task) => this.registry.jobs.listForTask(task.id)
      .some((job) => job.jobTypeId === id && activeStatuses.has(job.status)))) {
      throw new Error(`Job type execution settings cannot change while it has active jobs: ${id}`);
    }
    this.registry.jobTypes.updateConfiguration(id, capabilityProfile, worktreeStrategy, defaultAgentProfileId, this.clock.now());
    return this.requireJobType(id);
  }

  setJobTypeDefault(id: string, agentProfileId: string): JobTypeConfiguration {
    this.requireJobType(id);
    this.requireActiveAgentProfile(agentProfileId);
    this.registry.jobTypes.updateDefault(id, agentProfileId, this.clock.now());
    return this.requireJobType(id);
  }

  retireJobType(id: string): JobTypeConfiguration {
    const jobType = this.requireJobType(id);
    if (jobType.retired) return jobType;
    const now = this.clock.now();
    this.registry.jobTypes.updateRetirement(id, true, now, now);
    return this.requireJobType(id);
  }

  reactivateJobType(id: string): JobTypeConfiguration {
    const jobType = this.requireJobType(id);
    if (!jobType.retired) return jobType;
    this.requireActiveAgentProfile(jobType.defaultAgentProfileId);
    this.registry.jobTypes.updateRetirement(id, false, null, this.clock.now());
    return this.requireJobType(id);
  }

  private requireAgentProfile(id: string): AgentProfile {
    const profile = this.registry.agentProfiles.get(id);
    if (!profile) throw new Error(`Unknown agent profile: ${id}`);
    return profile;
  }
  private requireActiveAgentProfile(id: string): AgentProfile {
    const profile = this.requireAgentProfile(id);
    if (profile.retired) throw new Error(`Agent profile is retired: ${id}`);
    return profile;
  }
  private requireJobType(id: string): JobTypeConfiguration {
    const jobType = this.registry.jobTypes.get(id);
    if (!jobType) throw new Error(`Unknown job type: ${id}`);
    return jobType;
  }
}

function requiredId(value: string, label: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new Error(`${label} id must use letters, numbers, underscores, or hyphens`);
  return id;
}
function optionalDescription(value?: string): string | null { const result = value?.trim(); return result ? result : null; }
function validateHarnessOptions(profile: AgentProfile): void {
  const executable = executableAgentProfile(profile);
  const keys = Object.keys(executable.options);
  const allowed = profile.harness === "pi" ? ["thinking"] : ["effort", "fast"];
  const required = profile.harness === "pi" ? ["thinking"] : [];
  const unsupported = keys.find((key) => !allowed.includes(key));
  if (unsupported) throw new Error(`Agent profile ${profile.id} has unsupported ${profile.harness} option: ${unsupported}`);
  const missing = required.find((key) => !executable.options[key]);
  if (missing) throw new Error(`Agent profile ${profile.id} is missing ${missing}`);
}
