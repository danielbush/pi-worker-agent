import { expect, test } from "bun:test";
import { HarnessSandboxCatalog } from "../harness-sandbox.ts";

test("selects OS sandboxing for Pi and explicit trusted-process execution for Cursor", async () => {
  // arrange
  const catalog = HarnessSandboxCatalog.createNull();
  const policy = { writablePaths: ["/worktree"], temporaryDirectory: "/tmp/worker" };

  // act
  const pi = await catalog.sandbox("pi").wrap(["bun", "pi-worker.ts"], policy);
  const cursor = await catalog.sandbox("cursor-agent").wrap(["bun", "cursor-worker.ts"], policy);

  // assert
  expect(pi[0]).toBe("/bin/bash");
  expect(cursor).toEqual(["bun", "cursor-worker.ts"]);
  expect(catalog.state.pi?.mode).toBe("sandboxed");
  expect(catalog.state["cursor-agent"]?.mode).toBe("none");
});
