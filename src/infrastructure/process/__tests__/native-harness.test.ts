import { expect, test } from "bun:test";
import { NativeHarness, workerEnvironment } from "../native-harness.ts";
import { WorkerSandbox } from "../worker-sandbox.ts";

const invocation = {
  cwd: "/workspace", model: "model", effortLevel: "", tools: ["read"], prompt: "work",
  sessionDirectory: "/canonical/session", temporaryDirectory: "/tmp/private-worker", writablePaths: ["/canonical/session"],
  nativeInvocation: { executable: "/null/bin/harness", args: [] },
};

test("worker environment excludes manager and other-harness secrets", () => {
  // arrange
  const source = { PATH: "/bin", HOME: "/home/test", MANAGER_TOKEN: "secret", OPENAI_API_KEY: "manager-secret", CURSOR_API_KEY: "cursor-secret", PI_CODING_AGENT_DIR: "/manager/pi" };

  // act
  const pi = workerEnvironment(source, "pi", "/tmp/private", "/tmp/private/agent");
  const cursor = workerEnvironment(source, "cursor-agent", "/tmp/private", "/tmp/private/agent");

  // assert
  expect(pi).toEqual({ PATH: "/bin", HOME: "/tmp/private/home", TMPDIR: "/tmp/private", PI_CODING_AGENT_DIR: "/tmp/private/agent" });
  expect(cursor).toEqual({
    PATH: "/bin", HOME: "/tmp/private/home", TMPDIR: "/tmp/private",
    XDG_CONFIG_HOME: "/tmp/private/home/.config", CURSOR_CONFIG_DIR: "/tmp/private/home/.config/cursor",
    CURSOR_DATA_DIR: "/tmp/private/home/.cursor", AGENT_CLI_CREDENTIAL_STORE: "memory", CURSOR_API_KEY: "cursor-secret",
  });
});

test("removes selected credentials when native spawn throws", async () => {
  // arrange
  let provisioned = 0;
  const removed: string[] = [];
  const harness = new NativeHarness({ spawn: () => { throw new Error("spawn failed"); } }, WorkerSandbox.createNull(), {
    provisionPi: async () => { provisioned += 1; },
    provisionCursor: async () => {},
    remove: async (path) => { removed.push(path); },
    environment: () => ({ PATH: "/bin" }),
  });

  // act/assert
  await expect(harness.start({ ...invocation, harness: "pi" })).rejects.toThrow("spawn failed");
  expect(provisioned).toBe(1);
  expect(removed).toEqual(["/tmp/private-worker/home"]);
  expect(harness.state.sandbox.reset).toBe(true);
});

test("provisions only Cursor into its disposable home and cleans it after exit", async () => {
  // arrange
  const provisioned: string[] = [];
  const removed: string[] = [];
  const empty = () => new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const harness = new NativeHarness({
    spawn: () => ({ pid: 9, stdout: empty(), stderr: empty(), exited: Promise.resolve(0), kill: () => {} }),
  }, WorkerSandbox.createNull(), {
    provisionPi: async () => { provisioned.push("pi"); },
    provisionCursor: async (path) => { provisioned.push(`cursor:${path}`); },
    remove: async (path) => { removed.push(path); },
    environment: () => ({ PATH: "/bin", CURSOR_AUTH_TOKEN: "selected-token", PI_SECRET: "absent" }),
  });

  // act
  await (await harness.start({ ...invocation, harness: "cursor-agent" })).exited();

  // assert
  expect(provisioned).toEqual(["cursor:/tmp/private-worker/home"]);
  expect(removed).toEqual(["/tmp/private-worker/home"]);
  expect(harness.state.environments[0]?.CURSOR_AUTH_TOKEN).toBe("selected-token");
  expect(harness.state.environments[0]?.PI_SECRET).toBeUndefined();
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
  expect(cursor.state.environments[0]?.CURSOR_DATA_DIR).toBe("/tmp/private-worker/home/.cursor");
  expect(cursor.state.environments[0]?.MANAGER_SECRET).toBeUndefined();
  expect(pi.state.sandbox.configurations[0]?.filesystem?.denyRead).toContain("~/.config/cursor");
  expect(cursor.state.sandbox.configurations[0]?.filesystem?.denyRead).toContain("~/.pi");
  expect(pi.state.invocations[0]?.temporaryDirectory.startsWith("/canonical/")).toBe(false);
});
