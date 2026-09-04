import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectCollectionPaths } from "../../src/domain/project-collection-paths.ts";
import { FileSystem } from "../../src/infrastructure/filesystem/file-system.ts";
import { ManagedProjectStructure } from "../../src/infrastructure/filesystem/managed-project-structure.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("requires PROJECT.md and inventories immediate project entries without hiding files", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-project-structure-"));
  roots.push(root);
  mkdirSync(join(root, "projects", "demo"), { recursive: true });
  mkdirSync(join(root, "projects", ".test", "diagnostic"), { recursive: true });
  mkdirSync(join(root, "projects", ".archive", "old"), { recursive: true });
  writeFileSync(join(root, "PROJECT.md"), "# Policy\n");
  writeFileSync(join(root, "projects", "demo", "sequence.md"), "# Demo\n");
  writeFileSync(join(root, "projects", ".test", "diagnostic", "sequence.md"), "# Diagnostic\n");
  writeFileSync(join(root, "projects", ".archive", "old", "sequence.md"), "# Old\n");
  writeFileSync(join(root, "projects", "misplaced.txt"), "not a project\n");

  // act
  const snapshot = ManagedProjectStructure.create(new ProjectCollectionPaths(root), FileSystem.create()).inspect();

  // assert
  expect(snapshot).toEqual({
    dataRoot: root,
    roots: {
      active: join(root, "projects"),
      test: join(root, "projects", ".test"),
      archive: join(root, "projects", ".archive"),
    },
    entries: [
      { collection: "active", name: "demo", kind: "directory", hasSequenceFile: true },
      { collection: "active", name: "misplaced.txt", kind: "file", hasSequenceFile: false },
      { collection: "test", name: "diagnostic", kind: "directory", hasSequenceFile: true },
      { collection: "archive", name: "old", kind: "directory", hasSequenceFile: true },
    ],
  });
});
