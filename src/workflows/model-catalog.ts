import type { HarnessName } from "../domain/execution-profile.ts";
import { HarnessSetup, type HarnessModelListing } from "../infrastructure/process/harness-setup.ts";
import { WorkflowProfileLoader } from "./workflow-profiles.ts";

export interface ProfileCatalogStatus {
  name: string;
  model: string;
  available: boolean;
}

export interface ModelCatalogReport extends HarnessModelListing {
  profiles: ProfileCatalogStatus[];
}

/** Lists live harness catalogs outside the worker sandbox and compares WORKFLOW.md pins. */
export class ModelCatalog {
  constructor(
    private readonly setup: HarnessSetup,
    private readonly profiles: WorkflowProfileLoader,
  ) {}

  static create(root: string): ModelCatalog {
    return new ModelCatalog(HarnessSetup.create(), WorkflowProfileLoader.create(root));
  }

  static createNull(
    setup: HarnessSetup = HarnessSetup.createNull(),
    markdown = "```yaml\nprofiles:\n  pi-sol-high:\n    harness: pi\n    model: openai-codex/gpt-5.6-sol\n    thinking: high\n  cursor-grok-high:\n    harness: cursor-agent\n    model: cursor-grok-4.5-high\ndefaults:\n  plan: pi-sol-high\n  implement: pi-sol-high\n  review: pi-sol-high\n```\n",
  ): ModelCatalog {
    return new ModelCatalog(setup, WorkflowProfileLoader.createNull(markdown));
  }

  discover(harness?: HarnessName, cwd = process.cwd()): ModelCatalogReport[] {
    const policy = this.profiles.load();
    return this.setup.discoverModels(harness, cwd).map((listing) => ({
      ...listing,
      profiles: Object.values(policy.profiles)
        .filter((profile) => profile.harness === listing.harness)
        .map((profile) => ({ name: profile.name, model: profile.model, available: listing.models.includes(profile.model) })),
    }));
  }
}

export function formatModelCatalog(reports: readonly ModelCatalogReport[]): string {
  return reports.map((report) => {
    const lines: string[] = [report.harness];
    if (report.error) lines.push(`  error: ${report.error}`);
    for (const model of report.models) lines.push(`  ${model}`);
    for (const profile of report.profiles) {
      lines.push(`  profile ${profile.name}: ${profile.model} ${profile.available ? "available" : "missing"}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}
