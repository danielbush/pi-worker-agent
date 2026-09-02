import { createHash } from "node:crypto";

export type HarnessName = "pi" | "cursor-agent";
export type CapabilityProfile = "read-only" | "code" | "test";

export interface WorkerProfile {
  name: string;
  harness: HarnessName;
  model: string;
  options: Readonly<Record<string, string>>;
  fingerprint: string;
}

export interface WorkflowProfiles {
  profiles: Readonly<Record<string, WorkerProfile>>;
  defaults: Readonly<Record<string, string>>;
}

export interface NativeInvocationSnapshot {
  executable: string;
  args: readonly string[];
}

export const PURPOSE_CAPABILITIES: Readonly<Record<string, CapabilityProfile>> = {
  investigate: "read-only",
  plan: "read-only",
  implement: "code",
  review: "read-only",
  fix: "code",
  test: "test",
};

/** Trusted application policy. Markdown and manager input cannot alter this mapping. */
export function capabilityForPurpose(purpose: string): CapabilityProfile {
  const capability = PURPOSE_CAPABILITIES[purpose];
  if (!capability) throw new Error(`Unsupported job purpose: ${purpose}`);
  return capability;
}

export function profileFingerprint(value: Omit<WorkerProfile, "fingerprint">): string {
  const canonical = JSON.stringify({
    name: value.name,
    harness: value.harness,
    model: value.model,
    options: Object.fromEntries(Object.entries(value.options).sort(([a], [b]) => a.localeCompare(b))),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
