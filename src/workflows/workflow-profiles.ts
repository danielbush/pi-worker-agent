import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PURPOSE_CAPABILITIES,
  profileFingerprint,
  type HarnessName,
  type WorkerProfile,
  type WorkflowProfiles,
} from "../domain/execution-profile.ts";

interface WorkflowFileDriver { read(path: string): string; }

const REQUIRED_DEFAULTS = ["plan", "implement", "review"] as const;

/** INFRASTRUCTURE_CONSUMER: compiles the one fenced YAML profile policy in WORKFLOW.md. */
export class WorkflowProfileLoader {
  constructor(private readonly root: string, private readonly files: WorkflowFileDriver) {}

  static create(root: string): WorkflowProfileLoader {
    return new WorkflowProfileLoader(root, { read: (path) => readFileSync(path, "utf8") });
  }

  static createNull(markdown: string): WorkflowProfileLoader {
    return new WorkflowProfileLoader("/null", { read: () => markdown });
  }

  load(): WorkflowProfiles {
    return parseWorkflowProfiles(this.files.read(join(this.root, "WORKFLOW.md")));
  }
}

export function parseWorkflowProfiles(markdown: string): WorkflowProfiles {
  const yamlFences = [...markdown.matchAll(/^```yaml[ \t]*\n([\s\S]*?)^```[ \t]*$/gm)].map((match) => match[1]!);
  const candidates = yamlFences.filter((body) => /^(?:profiles|defaults):[ \t]*$/m.test(body));
  if (candidates.length !== 1) {
    throw new Error(`WORKFLOW.md must contain exactly one fenced YAML profiles configuration; found ${candidates.length}`);
  }

  const body = candidates[0]!;
  if ((body.match(/^profiles:[ \t]*$/gm) ?? []).length !== 1 || (body.match(/^defaults:[ \t]*$/gm) ?? []).length !== 1) {
    throw new Error("WORKFLOW.md profile configuration must contain exactly one top-level profiles and defaults section");
  }
  if (/^[ \t]+(?:profiles|defaults):[ \t]*$/m.test(body)) {
    throw new Error("WORKFLOW.md profiles and defaults sections must be unindented");
  }

  const rawProfiles: Record<string, Record<string, string>> = {};
  const defaults: Record<string, string> = {};
  let section: "profiles" | "defaults" | undefined;
  let profile: string | undefined;
  for (const [index, original] of body.split("\n").entries()) {
    if (!original.trim() || original.trimStart().startsWith("#")) continue;
    if (original.includes("\t")) throw new Error(`Tabs are not allowed in workflow profile YAML at line ${index + 1}`);
    const indent = original.length - original.trimStart().length;
    const line = original.trim();
    if (indent === 0 && (line === "profiles:" || line === "defaults:")) {
      section = line.slice(0, -1) as "profiles" | "defaults";
      profile = undefined;
      continue;
    }
    const pair = /^([A-Za-z0-9][A-Za-z0-9_-]*):(?:\s+([^#]+?)\s*)?$/.exec(line);
    if (!pair) throw new Error(`Invalid workflow profile YAML at line ${index + 1}: ${line}`);
    const [, key, value] = pair;
    if (section === "profiles" && indent === 2 && value === undefined) {
      if (rawProfiles[key!]) throw new Error(`Duplicate worker profile: ${key}`);
      rawProfiles[key!] = {};
      profile = key;
    } else if (section === "profiles" && indent === 4 && profile && value !== undefined) {
      if (rawProfiles[profile]![key!] !== undefined) throw new Error(`Duplicate option ${key} in profile ${profile}`);
      rawProfiles[profile]![key!] = scalar(value);
    } else if (section === "defaults" && indent === 2 && value !== undefined) {
      if (!(key! in PURPOSE_CAPABILITIES)) throw new Error(`Unsupported default job purpose: ${key}`);
      if (defaults[key!] !== undefined) throw new Error(`Duplicate default purpose: ${key}`);
      defaults[key!] = scalar(value);
    } else {
      throw new Error(`Invalid workflow profile structure at line ${index + 1}: ${line}`);
    }
  }

  const profiles: Record<string, WorkerProfile> = {};
  for (const [name, values] of Object.entries(rawProfiles).sort(([a], [b]) => a.localeCompare(b))) {
    const harness = values.harness;
    const model = values.model;
    if (harness !== "pi" && harness !== "cursor-agent") throw new Error(`Profile ${name} has unknown harness: ${harness ?? "missing"}`);
    if (!model) throw new Error(`Profile ${name} is missing model`);
    const allowed = harness === "pi" ? new Set(["harness", "model", "thinking"]) : new Set(["harness", "model"]);
    for (const key of Object.keys(values)) if (!allowed.has(key)) throw new Error(`Profile ${name} has unsupported ${harness} option: ${key}`);
    if (harness === "pi" && !values.thinking) throw new Error(`Pi profile ${name} is missing thinking`);
    const options = Object.fromEntries(Object.entries(values).filter(([key]) => key !== "harness" && key !== "model").sort(([a], [b]) => a.localeCompare(b)));
    const base = { name, harness: harness as HarnessName, model, options };
    profiles[name] = { ...base, fingerprint: profileFingerprint(base) };
  }
  if (!Object.keys(profiles).length) throw new Error("WORKFLOW.md defines no worker profiles");
  for (const purpose of REQUIRED_DEFAULTS) if (!defaults[purpose]) throw new Error(`WORKFLOW.md is missing required default purpose: ${purpose}`);
  for (const [purpose, name] of Object.entries(defaults)) {
    if (!profiles[name]) throw new Error(`Default ${purpose} references unknown profile: ${name}`);
  }
  return { profiles, defaults: Object.fromEntries(Object.entries(defaults).sort(([a], [b]) => a.localeCompare(b))) };
}

function scalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\[\]{},&*!|>@`]/.test(trimmed) || /^['"]/.test(trimmed)) {
    throw new Error(`Profile values must be plain YAML scalars: ${value}`);
  }
  return trimmed;
}
