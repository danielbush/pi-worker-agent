import { expect, test } from "bun:test";
import type { HarnessName } from "../../../domain/execution-profile.ts";
import { HarnessEnvironmentCatalog, type HarnessEnvironment, type HarnessEnvironmentInput, type PreparedHarnessEnvironment } from "../harness-environment.ts";
import { CursorHarnessEnvironment } from "../harness-environments/cursor-harness-environment.ts";
import { PiHarnessEnvironment } from "../harness-environments/pi-harness-environment.ts";
import { HarnessSandboxCatalog } from "../harness-sandbox.ts";
import { NullSandbox } from "../harness-sandboxes/null-sandbox.ts";
import { NativeHarness } from "../native-harness.ts";
import { WorkerSandbox } from "../worker-sandbox.ts";

const invocation = {
  cwd: "/workspace", model: "model", effortLevel: "", tools: ["read"], prompt: "work",
  sessionDirectory: "/canonical/session", temporaryDirectory: "/tmp/private-worker", writablePaths: ["/canonical/session"],
  nativeInvocation: { executable: "/null/bin/harness", args: [] },
};

test("worker environments exclude manager and other-harness secrets", async () => {
  // arrange
  const source = { PATH: "/bin", HOME: "/home/test", MANAGER_TOKEN: "secret", OPENAI_API_KEY: "manager-secret", CURSOR_API_KEY: "cursor-secret", PI_CODING_AGENT_DIR: "/manager/pi" };

  // act
  const pi = await PiHarnessEnvironment.createNull(source).prepare({ temporaryDirectory: "/tmp/private" });
  const cursor = await CursorHarnessEnvironment.createNull(source).prepare({ temporaryDirectory: "/tmp/private" });

  // assert
  expect(pi.env).toEqual({ PATH: "/bin", HOME: "/tmp/private/home", TMPDIR: "/tmp/private", PI_CODING_AGENT_DIR: "/tmp/private/home/.pi/agent" });
  expect(cursor.env).toEqual({ PATH: "/bin", HOME: "/tmp/private/home", TMPDIR: "/tmp/private", CURSOR_API_KEY: "cursor-secret" });
});

test("uses a private HOME for Cursor SDK credentials", async () => {
  const cursor = await CursorHarnessEnvironment.createNull({ PATH: "/bin", HOME: "/Users/me" }).prepare({ temporaryDirectory: "/tmp/private" });
  expect(cursor.env.HOME).toBe("/tmp/private/home");
  expect(cursor.env.CURSOR_API_KEY).toBeUndefined();
});

test("removes selected credentials when native spawn throws", async () => {
  // arrange
  const environment = new TrackingHarnessEnvironment("pi");
  const harness = new NativeHarness(
    { spawn: () => { throw new Error("spawn failed"); } },
    new HarnessSandboxCatalog([{ harness: "pi", sandbox: WorkerSandbox.createNull() }]),
    new HarnessEnvironmentCatalog([environment]),
  );

  // act/assert
  await expect(harness.start({ ...invocation, harness: "pi" })).rejects.toThrow("spawn failed");
  expect(environment.state).toEqual({ prepared: 1, cleaned: 1 });
  expect(harness.state.sandboxes.pi?.reset).toBe(true);
});

test("selects only the requested harness environment and cleans it after exit", async () => {
  // arrange
  const pi = new TrackingHarnessEnvironment("pi");
  const cursor = new TrackingHarnessEnvironment("cursor-agent", { PATH: "/bin", CURSOR_API_KEY: "selected-key" });
  const harness = new NativeHarness(
    { spawn: () => ({ pid: 9, stdout: emptyStream(), stderr: emptyStream(), exited: Promise.resolve(0), kill: () => {} }) },
    new HarnessSandboxCatalog([{ harness: "cursor-agent", sandbox: NullSandbox.createNull() }]),
    new HarnessEnvironmentCatalog([pi, cursor]),
  );

  // act
  await (await harness.start({ ...invocation, harness: "cursor-agent" })).exited();

  // assert
  expect(pi.state).toEqual({ prepared: 0, cleaned: 0 });
  expect(cursor.state).toEqual({ prepared: 1, cleaned: 1 });
  expect(harness.state.environments[0]?.CURSOR_API_KEY).toBe("selected-key");
});

test("uses a non-canonical private directory for only the selected harness", async () => {
  // arrange
  const pi = NativeHarness.createNull();
  const cursor = NativeHarness.createNull();

  // act
  await (await pi.start({ ...invocation, harness: "pi" })).exited();
  await (await cursor.start({ ...invocation, harness: "cursor-agent" })).exited();

  // assert
  expect(pi.state.environments[0]?.HOME).toBe("/tmp/private-worker/home");
  expect(pi.state.environments[0]?.PI_CODING_AGENT_DIR).toBe("/tmp/private-worker/home/.pi/agent");
  expect(pi.state.environments[0]?.CURSOR_API_KEY).toBeUndefined();
  expect(cursor.state.environments[0]?.HOME).toBe("/tmp/private-worker/home");
  expect(cursor.state.environments[0]?.PI_CODING_AGENT_DIR).toBeUndefined();
  expect(cursor.state.environments[0]?.CURSOR_API_KEY).toBe("cursor-selected");
  expect(cursor.state.environments[0]?.MANAGER_SECRET).toBeUndefined();
  expect(pi.state.sandboxes.pi?.mode).toBe("sandboxed");
  expect(pi.state.sandboxes.pi?.configurations[0]?.filesystem?.denyRead).toContain("~/.config/cursor");
  expect(cursor.state.sandboxes["cursor-agent"]?.mode).toBe("none");
  expect(cursor.state.sandboxes["cursor-agent"]?.configurations).toEqual([]);
  expect(pi.state.invocations[0]?.temporaryDirectory.startsWith("/canonical/")).toBe(false);
});

class TrackingHarnessEnvironment implements HarnessEnvironment {
  readonly deniedReadPaths = ["~/.credentials"];
  readonly state = { prepared: 0, cleaned: 0 };

  constructor(readonly harness: HarnessName, private readonly env: Record<string, string> = { PATH: "/bin" }) {}

  async prepare(_input: HarnessEnvironmentInput): Promise<PreparedHarnessEnvironment> {
    this.state.prepared += 1;
    return {
      env: { ...this.env },
      cleanup: async () => { this.state.cleaned += 1; },
    };
  }
}

function emptyStream(): ReadableStream<Uint8Array> { return new ReadableStream({ start(controller) { controller.close(); } }); }
