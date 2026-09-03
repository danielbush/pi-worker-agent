import { expect, test } from "bun:test";
import type { AgentProfile } from "../../domain/agent-profile.ts";
import { HarnessSetup } from "../../infrastructure/process/harness-setup.ts";
import { AgentProfileRepository } from "../../storage/agent-profile-repository.ts";
import { formatModelCatalog, ModelCatalog } from "../model-catalog.ts";

const profiles = AgentProfileRepository.createNull([
  profile("pi-sol-high", "pi", "openai-codex/gpt-5.6-sol", '{"thinking":"high"}'),
  profile("cursor-grok-high", "cursor-agent", "grok-4.5", '{"effort":"high","fast":"false"}'),
]);

test("lists live catalog ids and marks active database profile pins available or missing", () => {
  const catalog = ModelCatalog.createNull(profiles, HarnessSetup.createNull({ cursorModels: ["grok-4.6", "composer-2.5"] }));
  const reports = catalog.discover();
  expect(reports.find((report) => report.harness === "pi")?.models).toEqual(["openai-codex/gpt-5.6-sol"]);
  expect(reports.find((report) => report.harness === "cursor-agent")?.profiles).toEqual([{ name: "cursor-grok-high", model: "grok-4.5", available: false }]);
  expect(formatModelCatalog(reports)).toContain("profile cursor-grok-high: grok-4.5 missing");
  expect(formatModelCatalog(reports)).toContain("profile pi-sol-high: openai-codex/gpt-5.6-sol available");
});

test("can list one harness and reports a probe failure without inventing ids or hiding Pi", () => {
  const catalog = ModelCatalog.createNull(profiles, HarnessSetup.createNull({ authenticated: false }));
  const reports = catalog.discover();
  const [cursor] = catalog.discover("cursor-agent");
  expect(reports.find((report) => report.harness === "pi")?.models).toEqual(["openai-codex/gpt-5.6-sol"]);
  expect(reports.find((report) => report.harness === "pi")?.error).toBeUndefined();
  expect(cursor?.harness).toBe("cursor-agent");
  expect(cursor?.models).toEqual([]);
  expect(cursor?.error).toMatch(/authentication|authenticated|logged in/i);
});

function profile(id: string, harness: AgentProfile["harness"], model: string, options: string): AgentProfile {
  return { id, description: null, harness, model, options, retired: false, archiveDate: null, createdAt: "now", updatedAt: "now" };
}
