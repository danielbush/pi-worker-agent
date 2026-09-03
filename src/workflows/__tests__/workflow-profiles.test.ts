import { expect, test } from "bun:test";
import { WorkflowProfileLoader } from "../workflow-profiles.ts";

const POLICY = `# Workflow

\`\`\`yaml
profiles:
  pi-high:
    harness: pi
    model: openai-codex/gpt-5.6-sol
    thinking: high
  cursor-high:
    harness: cursor-agent
    model: grok-4.5
    effort: high
    fast: false
defaults:
  plan: pi-high
  implement: cursor-high
  review: pi-high
\`\`\`
`;

test("strictly compiles harness-native profiles and defaults", () => {
  // arrange
  const loader = WorkflowProfileLoader.createNull(POLICY);

  // act
  const policy = loader.load();

  // assert
  expect(policy.defaults).toEqual({ implement: "cursor-high", plan: "pi-high", review: "pi-high" });
  expect(policy.profiles["pi-high"]).toMatchObject({ harness: "pi", model: "openai-codex/gpt-5.6-sol", options: { thinking: "high" } });
  expect(policy.profiles["cursor-high"]).toMatchObject({ harness: "cursor-agent", model: "grok-4.5", options: { effort: "high", fast: "false" } });
  expect(policy.profiles["pi-high"]?.fingerprint).toHaveLength(64);
});

test("fingerprints are deterministic across native option order", () => {
  const reordered = POLICY.replace("    harness: pi\n    model: openai-codex/gpt-5.6-sol\n    thinking: high", "    thinking: high\n    model: openai-codex/gpt-5.6-sol\n    harness: pi");
  expect(WorkflowProfileLoader.createNull(reordered).load().profiles["pi-high"]?.fingerprint)
    .toBe(WorkflowProfileLoader.createNull(POLICY).load().profiles["pi-high"]?.fingerprint);
});

test("rejects repeated or malformed structure, bad keys, purposes, defaults, and references", () => {
  expect(() => WorkflowProfileLoader.createNull(`${POLICY}\n${POLICY}`).load()).toThrow("exactly one");
  expect(() => WorkflowProfileLoader.createNull(POLICY.replace("defaults:\n", "defaults:\nprofiles:\n")).load()).toThrow("exactly one top-level");
  expect(() => WorkflowProfileLoader.createNull(POLICY.replace("profiles:\n", " profiles:\n")).load()).toThrow("top-level");
  expect(() => WorkflowProfileLoader.createNull(POLICY.replace("    thinking: high", "    thinking: high\n    thinking: low")).load()).toThrow("Duplicate option");
  expect(() => WorkflowProfileLoader.createNull(POLICY.replace("  review: pi-high\n", "  deploy: pi-high\n")).load()).toThrow("Unsupported default");
  expect(() => WorkflowProfileLoader.createNull(POLICY.replace("  review: pi-high\n", "")).load()).toThrow("missing required default");
  expect(() => WorkflowProfileLoader.createNull(POLICY.replace("  review: pi-high", "  review: missing")).load()).toThrow("unknown profile");
  expect(() => WorkflowProfileLoader.createNull(POLICY.replace("    thinking: high", "    speed: high")).load()).toThrow("unsupported pi option");
  expect(() => WorkflowProfileLoader.createNull(POLICY.replace("    fast: false", "    thinking: high")).load()).toThrow("unsupported cursor-agent option");
});
