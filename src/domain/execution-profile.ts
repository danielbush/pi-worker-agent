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

export interface NativeInvocationSnapshot {
  executable: string;
  args: readonly string[];
}

export function toolsForCapability(capability: CapabilityProfile): string[] {
  const read = ["read", "grep", "find", "ls"];
  if (capability === "code") return [...read, "write", "edit", "bash"];
  if (capability === "test") return [...read, "bash"];
  return read;
}

export function parseProfileOptions(encoded: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { throw new Error("Profile options snapshot is malformed JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
    throw new Error("Profile options snapshot must be a JSON object of strings");
  }
  return Object.fromEntries(Object.entries(parsed as Record<string, string>).sort(([a], [b]) => a.localeCompare(b)));
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
