import { expect, test } from "bun:test";
import { ConfinedTextFiles } from "../../infrastructure/filesystem/confined-text-files.ts";
import { Registry } from "../../storage/registry.ts";
import { ProjectFileManager } from "../project-file-manager.ts";

const PROJECT = {
  id: "project_demo",
  directoryName: "demo",
  title: "Demo",
  description: null,
  createdAt: "2026-09-03T00:00:00Z",
  lastUsedAt: "2026-09-03T00:00:00Z",
};

function setup() {
  const files = ConfinedTextFiles.createNull({
    "demo/sequence.md": "# Before\n",
  });
  return {
    files,
    manager: new ProjectFileManager(Registry.createNull({ projects: [PROJECT] }), files),
  };
}

test("updates a registered project file and returns its diff", () => {
  // arrange
  const { files, manager } = setup();

  // act
  const result = manager.manage({
    project: "proj",
    relativePath: "sequence.md",
    operation: "update",
    expectedContent: "# Before\n",
    content: "# After\n",
  });

  // assert
  expect(result).toMatchObject({
    project: PROJECT,
    operation: "update",
    before: "# Before\n",
    after: "# After\n",
    diff: "--- a/demo/sequence.md\n+++ b/demo/sequence.md\n@@\n-# Before\n+# After",
  });
  expect(files.state.changes).toEqual([{
    relativePath: "demo/sequence.md",
    operation: "update",
    before: "# Before\n",
    after: "# After\n",
  }]);
});

test("creates and deletes files with optimistic content checks", () => {
  // arrange
  const { files, manager } = setup();

  // act
  manager.manage({ project: "demo", relativePath: "note.md", operation: "create", content: "hello\n" });
  manager.manage({
    project: "demo",
    relativePath: "note.md",
    operation: "delete",
    expectedContent: "hello\n",
  });

  // assert
  expect(files.state.changes.map((change) => change.operation)).toEqual(["create", "delete"]);
});

test("rejects unknown projects, traversal, and stale updates", () => {
  // arrange
  const { manager } = setup();

  // act / assert
  expect(() => manager.manage({
    project: "unknown",
    relativePath: "sequence.md",
    operation: "update",
    expectedContent: "# Before\n",
    content: "changed\n",
  })).toThrow("Unknown project");
  expect(() => manager.manage({
    project: "demo",
    relativePath: "../outside.md",
    operation: "create",
    content: "escape\n",
  })).toThrow("invalid segment");
  expect(() => manager.manage({
    project: "demo",
    relativePath: ".git/config",
    operation: "create",
    content: "unsafe\n",
  })).toThrow("invalid segment");
  expect(() => manager.manage({
    project: "demo",
    relativePath: "sequence.md",
    operation: "update",
    expectedContent: "stale\n",
    content: "changed\n",
  })).toThrow("changed since inspection");
});
