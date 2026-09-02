import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";
import { WorkerSandbox } from "../../src/infrastructure/process/worker-sandbox.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
  "allows assigned writes and denies sibling writes for the whole process tree",
  async () => {
    // arrange
    const root = mkdtempSync(join(tmpdir(), "pi-worker-sandbox-"));
    roots.push(root);
    const worktree = join(root, "worktree");
    const temporaryDirectory = join(root, "worker-tmp");
    const allowedFile = join(worktree, "allowed.txt");
    const deniedFile = join(root, "denied.txt");
    const escapedFile = join(root, "escaped.txt");
    mkdirSync(worktree);
    mkdirSync(temporaryDirectory);
    symlinkSync(root, join(worktree, "escape"));
    const sandbox = WorkerSandbox.create();

    try {
      // act
      const command = await sandbox.wrap(
        [
          "/bin/sh",
          "-c",
          `printf allowed > '${allowedFile}'; printf denied > '${deniedFile}'; printf escaped > '${join(worktree, "escape", "escaped.txt")}'`,
        ],
        {
          writablePaths: [worktree, temporaryDirectory],
          temporaryDirectory,
        },
      );
      const result = Bun.spawnSync(command, {
        cwd: root,
        env: { ...process.env, TMPDIR: temporaryDirectory },
        stdout: "pipe",
        stderr: "pipe",
      });

      // assert
      expect(result.exitCode).not.toBe(0);
      expect(existsSync(allowedFile)).toBe(true);
      expect(existsSync(deniedFile)).toBe(false);
      expect(existsSync(escapedFile)).toBe(false);
    } finally {
      await sandbox.reset();
    }
  },
);
