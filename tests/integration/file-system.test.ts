import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystem } from "../../src/infrastructure/filesystem/file-system.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("provides file and directory primitives without exposing Node filesystem values", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-file-system-"));
  roots.push(root);
  const fileSystem = FileSystem.create();
  const source = join(root, "source");
  const destination = join(root, "nested", "destination");

  // act
  fileSystem.createDirectory(source);
  const created = fileSystem.createTextFile(join(source, "note.md"), "hello\n");
  const createdAgain = fileSystem.createTextFile(join(source, "note.md"), "ignored\n");
  fileSystem.createDirectory(join(root, "nested"));
  fileSystem.move(source, destination);
  symlinkSync(join(destination, "note.md"), join(root, "note-link"));

  // assert
  expect(created).toBe(true);
  expect(createdAgain).toBe(false);
  expect(fileSystem.kind(source)).toBe("missing");
  expect(fileSystem.kind(destination)).toBe("directory");
  expect(fileSystem.kind(join(root, "note-link"))).toBe("file");
  expect(fileSystem.entryKind(join(root, "note-link"))).toBe("symbolic-link");
  expect(fileSystem.entries(destination)).toEqual([{ name: "note.md", kind: "file" }]);
});
