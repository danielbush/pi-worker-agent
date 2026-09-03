import { expect, test } from "bun:test";
import { HarnessSetup } from "../../infrastructure/process/harness-setup.ts";
import { formatModelCatalog, ModelCatalog } from "../model-catalog.ts";

test("lists live catalog ids and marks WORKFLOW pins available or missing", () => {
  const catalog = ModelCatalog.createNull(
    HarnessSetup.createNull({ cursorModels: ["grok-4.6", "composer-2.5"] }),
  );

  const reports = catalog.discover();

  expect(reports.find((report) => report.harness === "pi")?.models).toEqual(["openai-codex/gpt-5.6-sol"]);
  expect(reports.find((report) => report.harness === "cursor-agent")?.models).toEqual(["grok-4.6", "composer-2.5"]);
  expect(reports.find((report) => report.harness === "cursor-agent")?.profiles).toEqual([
    { name: "cursor-grok-high", model: "grok-4.5", available: false },
  ]);
  expect(formatModelCatalog(reports)).toContain("profile cursor-grok-high: grok-4.5 missing");
  expect(formatModelCatalog(reports)).toContain("profile pi-sol-high: openai-codex/gpt-5.6-sol available");
});

test("can list one harness and reports a probe failure without inventing ids or hiding Pi", () => {
  const catalog = ModelCatalog.createNull(HarnessSetup.createNull({ authenticated: false }));

  const reports = catalog.discover();
  const [cursor] = catalog.discover("cursor-agent");

  expect(reports.find((report) => report.harness === "pi")?.models).toEqual(["openai-codex/gpt-5.6-sol"]);
  expect(reports.find((report) => report.harness === "pi")?.error).toBeUndefined();
  expect(cursor?.harness).toBe("cursor-agent");
  expect(cursor?.models).toEqual([]);
  expect(cursor?.error).toMatch(/authentication|authenticated|logged in/i);
});
