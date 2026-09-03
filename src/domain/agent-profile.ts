import { profileFingerprint, type HarnessName, type WorkerProfile } from "./execution-profile.ts";

/** Durable manager-configured harness and model selection. */
export interface AgentProfile {
  id: string;
  description: string | null;
  harness: HarnessName;
  model: string;
  /** Canonical JSON object containing harness-native string options. */
  options: string;
  retired: boolean;
  archiveDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export function executableAgentProfile(profile: AgentProfile): WorkerProfile {
  const options = parseAgentProfileOptions(profile.options);
  const base = { name: profile.id, harness: profile.harness, model: profile.model, options };
  return { ...base, fingerprint: profileFingerprint(base) };
}

export function parseAgentProfileOptions(encoded: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { throw new Error("Agent profile options must be valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
    throw new Error("Agent profile options must be a JSON object of strings");
  }
  return Object.fromEntries(Object.entries(parsed as Record<string, string>).sort(([a], [b]) => a.localeCompare(b)));
}

export function canonicalAgentProfileOptions(options: Readonly<Record<string, string>>): string {
  if (Object.values(options).some((value) => typeof value !== "string")) throw new Error("Agent profile options must contain only strings");
  return JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))));
}
