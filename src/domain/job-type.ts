import type { CapabilityProfile } from "./execution-profile.ts";

export type WorktreeStrategy = "workspace" | "new-worktree" | "dependency-worktree";

/** Durable manager-configured purpose, capability, workspace strategy, and default agent. */
export interface JobTypeConfiguration {
  id: string;
  description: string | null;
  capabilityProfile: CapabilityProfile;
  worktreeStrategy: WorktreeStrategy;
  defaultAgentProfileId: string;
  retired: boolean;
  archiveDate: string | null;
  createdAt: string;
  updatedAt: string;
}
