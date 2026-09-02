import { expect, test } from "bun:test";
import { WorkerSandbox } from "../worker-sandbox.ts";

test("wraps the whole worker command with a write allowlist", async () => {
  // arrange
  const sandbox = WorkerSandbox.createNull("darwin");

  // act
  const command = await sandbox.wrap(
    ["pi", "--print", "It's safe"],
    {
      writablePaths: ["/worktree", "/sessions", "/worktree"],
      temporaryDirectory: "/sessions/tmp",
    },
  );

  // assert
  expect(command).toEqual([
    "/bin/bash",
    "-c",
    `sandboxed 'pi' '--print' 'It'"'"'s safe'`,
  ]);
  expect(sandbox.state.configurations).toHaveLength(1);
  expect(sandbox.state.configurations[0]?.filesystem).toEqual({
    denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gh"],
    allowWrite: ["/worktree", "/sessions"],
    denyWrite: [],
  });
  expect(sandbox.state.configurations[0]?.enableWeakerNestedSandbox).toBe(false);
});

test("fails closed on Windows", async () => {
  // arrange
  const sandbox = WorkerSandbox.createNull("win32");

  // act
  const result = sandbox.wrap(["pi"], {
    writablePaths: [],
    temporaryDirectory: "/sessions/tmp",
  });

  // assert
  await expect(result).rejects.toThrow("Pi workers are unsupported on Windows");
  expect(sandbox.state.configurations).toEqual([]);
});

test("fails closed when platform dependencies are unavailable", async () => {
  // arrange
  const sandbox = WorkerSandbox.createNull("linux", false);

  // act
  const result = sandbox.wrap(["pi"], {
    writablePaths: [],
    temporaryDirectory: "/sessions/tmp",
  });

  // assert
  await expect(result).rejects.toThrow("Worker sandbox dependencies are unavailable");
  expect(sandbox.state.configurations).toEqual([]);
});
