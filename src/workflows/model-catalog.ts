import { executableAgentProfile } from "../domain/agent-profile.ts";
import type { HarnessName } from "../domain/execution-profile.ts";
import { HarnessSetup, type HarnessModelListing } from "../infrastructure/process/harness-setup.ts";
import type { AgentProfileRepository } from "../storage/agent-profile-repository.ts";

export interface ProfileCatalogStatus { name: string; model: string; available: boolean; }
export interface ModelCatalogReport extends HarnessModelListing { profiles: ProfileCatalogStatus[]; }

/** Lists live harness catalogs and compares active database-backed profile pins. */
export class ModelCatalog {
  constructor(private readonly setup: HarnessSetup, private readonly profiles: AgentProfileRepository) {}
  static create(profiles: AgentProfileRepository): ModelCatalog { return new ModelCatalog(HarnessSetup.create(), profiles); }
  static createNull(profiles: AgentProfileRepository, setup: HarnessSetup = HarnessSetup.createNull()): ModelCatalog { return new ModelCatalog(setup, profiles); }

  discover(harness?: HarnessName, cwd = process.cwd()): ModelCatalogReport[] {
    const active = this.profiles.list().filter((profile) => !profile.retired).map(executableAgentProfile);
    return this.setup.discoverModels(harness, cwd).map((listing) => ({
      ...listing,
      profiles: active.filter((profile) => profile.harness === listing.harness)
        .map((profile) => ({ name: profile.name, model: profile.model, available: listing.models.includes(profile.model) })),
    }));
  }
}

export function formatModelCatalog(reports: readonly ModelCatalogReport[]): string {
  return reports.map((report) => {
    const lines: string[] = [report.harness];
    if (report.error) lines.push(`  error: ${report.error}`);
    for (const model of report.models) lines.push(`  ${model}`);
    for (const profile of report.profiles) lines.push(`  profile ${profile.name}: ${profile.model} ${profile.available ? "available" : "missing"}`);
    return lines.join("\n");
  }).join("\n\n");
}
