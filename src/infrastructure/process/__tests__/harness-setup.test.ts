import { expect, test } from "bun:test";
import { CursorHarnessContract } from "../../../harnesses/cursor/cursor-harness-contract.ts";
import { PiHarnessContract } from "../../../harnesses/pi/pi-harness-contract.ts";
import { profileFingerprint, type WorkerProfile } from "../../../domain/execution-profile.ts";
import { HarnessSandboxCatalog } from "../harness-sandbox.ts";
import { HarnessSetup } from "../harness-setup.ts";

function driver(run: (command: string[]) => { exitCode: number; stdout: string; stderr: string }) {
  return {
    which: () => "/resolved/bin/bun",
    home: "/home/test",
    isExecutable: () => true,
    canonicalPath: (path: string) => path,
    run: (command: string[]) => run(command),
  };
}

test("checks and launches the same resolved absolute SDK worker runtime", () => {
  // arrange
  const commands: string[][] = [];
  const setup = new HarnessSetup(driver((command) => {
    commands.push(command);
    if (command.includes("--version")) return { exitCode: 0, stdout: "1.0.0", stderr: "" };
    if (command.includes("--help")) return { exitCode: 0, stdout: "run --model --thinking --tools --session-dir", stderr: "" };
    if (command.includes("auth")) return { exitCode: 0, stdout: "ready", stderr: "" };
    return { exitCode: 0, stdout: "openai-codex/gpt-5.6-sol", stderr: "" };
  }), HarnessSandboxCatalog.createNull(), [PiHarnessContract.create()]);

  // act
  const result = setup.verify(profile("pi", "openai-codex/gpt-5.6-sol", { thinking: "high" }), "read-only", "/workspace");

  // assert
  expect(commands.every((command) => command[0] === "/resolved/bin/bun")).toBe(true);
  expect(result.invocation.executable).toBe("/resolved/bin/bun");
  expect(result.invocation.args[0]).toEndWith("/pi-sdk-worker.ts");
});

test("prepares Pi and Cursor SDK invocations with native options", () => {
  // arrange
  const setup = HarnessSetup.createNull();

  // act
  const pi = setup.verify(profile("pi", "openai-codex/gpt-5.6-sol", { thinking: "high" }), "read-only", "/workspace");
  const cursor = setup.verify(profile("cursor-agent", "grok-4.5", { effort: "high", fast: "false" }), "code", "/workspace", "/worktrees/job");

  // assert
  expect(pi.invocation.args).toContain("--thinking");
  expect(pi.invocation.args).toContain("high");
  expect(pi.invocation.args).toContain("read,grep,find,ls");
  expect(cursor.invocation.executable).toBe("/null/bin/bun");
  expect(cursor.invocation.args[0]).toEndWith("/cursor-sdk-worker.ts");
  expect(cursor.invocation.args).toContain("grok-4.5");
  expect(cursor.invocation.args).toContain('{"effort":"high","fast":"false"}');
  expect(cursor.invocation.args).toContain("read,grep,find,ls,write,edit,bash");
  expect(cursor.invocation.args).not.toContain("--thinking");
});

test("fails closed for SDK authentication, catalog, and native option failures", () => {
  expect(() => HarnessSetup.createNull({ authenticated: false }).verify(profile("pi", "openai-codex/gpt-5.6-sol", { thinking: "high" }), "read-only", "/workspace")).toThrow("authentication");
  expect(() => HarnessSetup.createNull({ authenticated: false }).verify(profile("cursor-agent", "grok-4.5", { effort: "high" }), "code", "/workspace")).toThrow("authentication");
  expect(() => HarnessSetup.createNull({ cursorModels: ["other"] }).verify(profile("cursor-agent", "grok-4.5", { effort: "high" }), "code", "/workspace")).toThrow("unavailable");
  expect(() => HarnessSetup.createNull().verify(profile("pi", "openai-codex/gpt-5.6-sol", { thinking: "turbo" }), "read-only", "/workspace")).toThrow("invalid thinking");
});

test("matches exact Cursor SDK catalog ids", () => {
  // arrange
  const setup = new HarnessSetup(driver((command) => {
    if (command.includes("--version")) return { exitCode: 0, stdout: "1.0.30", stderr: "" };
    if (command.includes("--help")) return { exitCode: 0, stdout: "run --model --params --tools --session-dir probe-models probe-model probe-auth", stderr: "" };
    if (command.includes("probe-auth")) return { exitCode: 0, stdout: '{"status":"ready"}', stderr: "" };
    if (command.includes("probe-model")) {
      const model = command[command.indexOf("--model") + 1];
      return model === "grok-4.5" ? { exitCode: 0, stdout: "grok-4.5\n", stderr: "" } : { exitCode: 1, stdout: "", stderr: "unavailable" };
    }
    return { exitCode: 1, stdout: "", stderr: "unexpected" };
  }), HarnessSandboxCatalog.createNull(), [new CursorHarnessContract("/app/cursor-sdk-worker.ts")]);

  // act/assert
  const invocation = setup.verify(profile("cursor-agent", "grok-4.5", { effort: "high", fast: "false" }), "code", "/workspace").invocation;
  expect(invocation.args).toContain("grok-4.5");
  expect(invocation.args).toContain('{"effort":"high","fast":"false"}');
  expect(() => setup.verify(profile("cursor-agent", "Grok 4.5 High"), "code", "/workspace")).toThrow("model selection");
});

test("lists live catalogs without verify and isolates a probe failure", () => {
  // arrange
  const setup = HarnessSetup.createNull({ authenticated: false, cursorModels: ["invented"] });

  // act
  const listings = setup.discoverModels();

  // assert
  expect(listings.find((listing) => listing.harness === "pi")?.models).toEqual(["openai-codex/gpt-5.6-sol"]);
  expect(listings.find((listing) => listing.harness === "cursor-agent")?.models).toEqual([]);
  expect(listings.find((listing) => listing.harness === "cursor-agent")?.error).toMatch(/authenticated/i);
});

test("fails closed when the profile harness has no injected contract", () => {
  expect(() => HarnessSetup.createNull({ contracts: [PiHarnessContract.create()] })
    .verify(profile("cursor-agent", "grok-4.5", { effort: "high" }), "code", "/workspace"))
    .toThrow("Unknown harness: cursor-agent");
});

function profile(harness: "pi" | "cursor-agent", model: string, options: Record<string, string> = {}): WorkerProfile {
  const base = { name: "test", harness, model, options };
  return { ...base, fingerprint: profileFingerprint(base) };
}
