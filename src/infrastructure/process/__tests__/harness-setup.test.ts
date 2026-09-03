import { expect, test } from "bun:test";
import { CURSOR_CONTRACT_DIAGNOSTIC, HarnessSetup } from "../harness-setup.ts";
import { CursorHarnessContract } from "../../../harnesses/cursor/cursor-harness-contract.ts";
import { PiHarnessContract } from "../../../harnesses/pi/pi-harness-contract.ts";
import { profileFingerprint, type WorkerProfile } from "../../../domain/execution-profile.ts";
import { WorkerSandbox } from "../worker-sandbox.ts";

function driver(which: (command: string) => string | null, run: (command: string[]) => { exitCode: number; stdout: string; stderr: string }, extras: { canonicalPath?: (path: string) => string; isExecutable?: (path: string) => boolean } = {}) {
  return {
    which,
    home: "/home/test",
    isExecutable: extras.isExecutable ?? (() => true),
    canonicalPath: extras.canonicalPath ?? ((path: string) => path),
    run: (command: string[]) => run(command),
  };
}

test("checks and launches the same resolved absolute executable identity", () => {
  // arrange
  const commands: string[][] = [];
  const setup = new HarnessSetup(driver(() => "/resolved/bin/pi", (command) => {
      commands.push(command);
      if (command.includes("--version")) return { exitCode: 0, stdout: "1.0.0", stderr: "" };
      if (command.includes("--help")) return { exitCode: 0, stdout: "--mode --print --model --thinking --tools", stderr: "" };
      if (command.includes("auth")) return { exitCode: 0, stdout: "ready", stderr: "" };
      return { exitCode: 0, stdout: "openai-codex/gpt-5.6-sol", stderr: "" };
    }), WorkerSandbox.createNull(), [PiHarnessContract.create()]);

  // act
  const result = setup.verify(profile("pi", "openai-codex/gpt-5.6-sol", { thinking: "high" }), "read-only", "/workspace");

  // assert
  expect(commands.every((command) => command[0] === "/resolved/bin/pi")).toBe(true);
  expect(result.invocation.executable).toBe("/resolved/bin/pi");
});

test("prepares each harness's native invocation without a universal effort mapping", () => {
  // arrange
  const setup = HarnessSetup.createNull();

  // act
  const pi = setup.verify(profile("pi", "openai-codex/gpt-5.6-sol", { thinking: "high" }), "read-only", "/workspace");
  const cursor = setup.verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace");

  // assert
  expect(pi.invocation.args).toContain("--thinking");
  expect(pi.invocation.args).toContain("high");
  expect(pi.invocation.args).toContain("read,grep,find,ls");
  expect(cursor.invocation.args).toContain("cursor-grok-4.5-high");
  expect(cursor.invocation.args).toContain("--force");
  expect(cursor.invocation.args).toContain("--workspace");
  expect(cursor.invocation.args).toContain("/workspace");
  expect(cursor.invocation.args).not.toContain("--worktree");
  expect(cursor.invocation.args).not.toContain("-w");
  expect(cursor.invocation.args).not.toContain("--thinking");
});

test("pins Cursor --workspace to the launch path and never allocates -w/--worktree", () => {
  const setup = HarnessSetup.createNull();
  const cursor = setup.verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace", "/worktrees/job");
  expect(cursor.invocation.args).toContain("--workspace");
  expect(cursor.invocation.args[cursor.invocation.args.indexOf("--workspace") + 1]).toBe("/worktrees/job");
  expect(cursor.invocation.args).not.toContain("--worktree");
  expect(cursor.invocation.args.includes("-w")).toBe(false);
  expect(() => setup.verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace", "relative")).toThrow("absolute");
});

test("fails closed with a precise diagnostic when Cursor's stream contract is unverified", () => {
  expect(() => HarnessSetup.createNull({ versions: { "cursor-agent": "2026.08.25-3e8eec8" }, cursorContractVerified: false })
    .verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace"))
    .toThrow(CURSOR_CONTRACT_DIAGNOSTIC);
});

test("fails closed for auth, catalog, option, and unenforceable capability failures", () => {
  expect(() => HarnessSetup.createNull({ authenticated: false }).verify(profile("pi", "openai-codex/gpt-5.6-sol", { thinking: "high" }), "read-only", "/workspace")).toThrow("authentication");
  expect(() => HarnessSetup.createNull({ cursorModels: ["other"] }).verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace")).toThrow("unavailable");
  expect(() => HarnessSetup.createNull().verify(profile("pi", "openai-codex/gpt-5.6-sol", { thinking: "turbo" }), "read-only", "/workspace")).toThrow("invalid thinking");
  expect(() => HarnessSetup.createNull().verify(profile("cursor-agent", "cursor-grok-4.5-high"), "test", "/workspace")).toThrow("cannot enforce");
});

test("matches Cursor catalog ids and rejects label tokens from the same listing", () => {
  // arrange
  const catalog = "Available models\nauto - Auto (default)\ncursor-grok-4.5-high - Cursor Grok 4.5\n";
  const setup = new HarnessSetup(driver(() => "/resolved/bin/cursor-agent", (command) => {
      if (command.includes("--version")) return { exitCode: 0, stdout: "1.0.0-test", stderr: "" };
      if (command.includes("--help")) return { exitCode: 0, stdout: "--print --output-format --stream-partial-output --model --mode --force --trust --sandbox --workspace", stderr: "" };
      if (command.includes("status")) return { exitCode: 0, stdout: "Login successful", stderr: "" };
      if (command.includes("--list-models")) return { exitCode: 0, stdout: catalog, stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unexpected" };
    }), WorkerSandbox.createNull(), [CursorHarnessContract.create({ verifiedVersions: new Set(["1.0.0-test"]) })]);

  // act/assert
  expect(setup.verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace").invocation.args).toContain("cursor-grok-4.5-high");
  expect(() => setup.verify(profile("cursor-agent", "Auto"), "code", "/workspace")).toThrow("unavailable");
});

test("lists live catalogs without verify and isolates a harness probe failure", () => {
  const setup = HarnessSetup.createNull({ authenticated: false, cursorModels: ["invented"] });

  const listings = setup.discoverModels();

  expect(listings.find((listing) => listing.harness === "pi")?.models).toEqual(["openai-codex/gpt-5.6-sol"]);
  expect(listings.find((listing) => listing.harness === "cursor-agent")?.models).toEqual([]);
  expect(listings.find((listing) => listing.harness === "cursor-agent")?.error).toMatch(/logged in/i);
  expect(() => setup.verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace")).toThrow("authentication");
});

test("fails closed when the profile harness has no injected contract", () => {
  expect(() => HarnessSetup.createNull({ contracts: [PiHarnessContract.create()] })
    .verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace"))
    .toThrow("Unknown harness: cursor-agent");
});

test("snapshots the stable Cursor launcher, not the versioned install target", () => {
  const alias = "/home/test/.local/bin/agent";
  const versioned = "/home/test/.local/share/cursor-agent/versions/2026.08.25-3e8eec8/cursor-agent";
  const setup = new HarnessSetup(driver((name) => name === "agent" ? alias : null, (command) => {
    if (command.includes("--version")) return { exitCode: 0, stdout: "1.0.0-test", stderr: "" };
    if (command.includes("--help")) return { exitCode: 0, stdout: "--print --output-format --stream-partial-output --model --mode --force --trust --sandbox --workspace", stderr: "" };
    if (command.includes("status")) return { exitCode: 0, stdout: "Login successful", stderr: "" };
    if (command.includes("--list-models")) return { exitCode: 0, stdout: "Available models\ncursor-grok-4.5-high - Cursor Grok 4.5\n", stderr: "" };
    return { exitCode: 1, stdout: "", stderr: "unexpected" };
  }, { canonicalPath: (path) => path === alias ? versioned : path }), WorkerSandbox.createNull(), [
    CursorHarnessContract.create({ verifiedVersions: new Set(["1.0.0-test"]) }),
  ]);

  expect(setup.verify(profile("cursor-agent", "cursor-grok-4.5-high"), "code", "/workspace").invocation.executable).toBe(alias);
});

function profile(harness: "pi" | "cursor-agent", model: string, options: Record<string, string> = {}): WorkerProfile {
  const base = { name: "test", harness, model, options };
  return { ...base, fingerprint: profileFingerprint(base) };
}
