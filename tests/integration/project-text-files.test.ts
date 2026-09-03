import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectTextFiles } from "../../src/infrastructure/filesystem/project-text-files.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(): { root: string; files: ProjectTextFiles } {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-project-files-"));
  roots.push(root);
  mkdirSync(join(root, "projects", "demo", "nested"), { recursive: true });
  writeFileSync(join(root, "projects", "demo", "sequence.md"), "# Before\n");
  return { root, files: ProjectTextFiles.create(root) };
}

test("atomically creates, updates, and deletes project text files", () => {
  // arrange
  const { root, files } = setup();

  // act
  files.mutate({ directoryName: "demo", relativePath: "nested/note.md", operation: "create", content: "one\n" });
  files.mutate({
    directoryName: "demo",
    relativePath: "nested/note.md",
    operation: "update",
    expectedContent: "one\n",
    content: "two\n",
  });

  // assert
  expect(readFileSync(join(root, "projects", "demo", "nested", "note.md"), "utf8")).toBe("two\n");
  expect(readdirSync(join(root, "projects", "demo", "nested"))).toEqual(["note.md"]);

  // act
  files.mutate({
    directoryName: "demo",
    relativePath: "nested/note.md",
    operation: "delete",
    expectedContent: "two\n",
  });

  // assert
  expect(readdirSync(join(root, "projects", "demo", "nested"))).toEqual([]);
});

test("rejects symbolic-link path components and absolute paths", () => {
  // arrange
  const { root, files } = setup();
  const outside = mkdtempSync(join(tmpdir(), "pi-worker-project-files-outside-"));
  roots.push(outside);
  symlinkSync(outside, join(root, "projects", "demo", "linked"));

  // act / assert
  expect(() => files.mutate({
    directoryName: "demo",
    relativePath: "linked/escape.md",
    operation: "create",
    content: "escape\n",
  })).toThrow("contains a symbolic link");
  expect(() => files.mutate({
    directoryName: "demo",
    relativePath: "/tmp/escape.md",
    operation: "create",
    content: "escape\n",
  })).toThrow("must be relative");
  expect(readdirSync(outside)).toEqual([]);
});

test("rejects a symbolic-link projects root and non-UTF-8 files", () => {
  // arrange
  const linkedRoot = mkdtempSync(join(tmpdir(), "pi-worker-project-files-linked-root-"));
  const outside = mkdtempSync(join(tmpdir(), "pi-worker-project-files-linked-projects-"));
  roots.push(linkedRoot, outside);
  mkdirSync(join(outside, "demo"), { recursive: true });
  symlinkSync(outside, join(linkedRoot, "projects"));
  const linkedFiles = ProjectTextFiles.create(linkedRoot);

  // act / assert
  expect(() => linkedFiles.mutate({
    directoryName: "demo",
    relativePath: "note.md",
    operation: "create",
    content: "escape\n",
  })).toThrow("contains a symbolic link");

  // arrange
  const { root, files } = setup();
  writeFileSync(join(root, "projects", "demo", "binary.dat"), Uint8Array.from([0xff, 0xfe]));

  // act / assert
  expect(() => files.mutate({
    directoryName: "demo",
    relativePath: "binary.dat",
    operation: "update",
    expectedContent: "",
    content: "text\n",
  })).toThrow("not valid UTF-8 text");
});
