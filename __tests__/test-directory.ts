import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

/** Removes only a direct OS-temp child created with this test suite's prefix. */
export function removeTestDirectory(path: string): void {
  const resolved = resolve(path);
  if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith("pi-worker-")) {
    throw new Error(`Refusing to remove unsafe test directory: ${path}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}
