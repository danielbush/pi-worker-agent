import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfinedTextFiles } from "../../src/infrastructure/filesystem/confined-text-files.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(): { root: string; files: ConfinedTextFiles } {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-confined-text-files-"));
  roots.push(root);
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "existing.md"), "# Before\n");
  return { root, files: ConfinedTextFiles.create(root) };
}

test("atomically creates, updates, and deletes confined text files", () => {
  // arrange
  const { root, files } = setup();

  // act
  files.mutate({ relativePath: "nested/note.md", operation: "create", content: "one\n" });
  files.mutate({
    relativePath: "nested/note.md",
    operation: "update",
    expectedContent: "one\n",
    content: "two\n",
  });

  // assert
  expect(readFileSync(join(root, "nested", "note.md"), "utf8")).toBe("two\n");
  expect(readdirSync(join(root, "nested"))).toEqual(["note.md"]);

  // act
  files.mutate({
    relativePath: "nested/note.md",
    operation: "delete",
    expectedContent: "two\n",
  });

  // assert
  expect(readdirSync(join(root, "nested"))).toEqual([]);
});

test("rejects traversal, symbolic-link components, and absolute paths", () => {
  // arrange
  const { root, files } = setup();
  const outside = mkdtempSync(join(tmpdir(), "pi-worker-confined-text-files-outside-"));
  roots.push(outside);
  symlinkSync(outside, join(root, "linked"));

  // act / assert
  expect(() => files.mutate({ relativePath: "../escape.md", operation: "create", content: "escape\n" }))
    .toThrow("invalid segment");
  expect(() => files.mutate({ relativePath: "linked/escape.md", operation: "create", content: "escape\n" }))
    .toThrow("contains a symbolic link");
  expect(() => files.mutate({ relativePath: "/tmp/escape.md", operation: "create", content: "escape\n" }))
    .toThrow("must be relative");
  expect(readdirSync(outside)).toEqual([]);
});

test("rejects a symbolic-link root and non-UTF-8 files", () => {
  // arrange
  const parent = mkdtempSync(join(tmpdir(), "pi-worker-confined-text-files-linked-root-"));
  const outside = mkdtempSync(join(tmpdir(), "pi-worker-confined-text-files-linked-outside-"));
  roots.push(parent, outside);
  const linkedRoot = join(parent, "linked");
  symlinkSync(outside, linkedRoot);
  const linkedFiles = ConfinedTextFiles.create(linkedRoot);

  // act / assert
  expect(() => linkedFiles.mutate({ relativePath: "note.md", operation: "create", content: "escape\n" }))
    .toThrow("contains a symbolic link");

  // arrange
  const { root, files } = setup();
  writeFileSync(join(root, "binary.dat"), Uint8Array.from([0xff, 0xfe]));

  // act / assert
  expect(() => files.mutate({
    relativePath: "binary.dat",
    operation: "update",
    expectedContent: "",
    content: "text\n",
  })).toThrow("not valid UTF-8 text");
});
