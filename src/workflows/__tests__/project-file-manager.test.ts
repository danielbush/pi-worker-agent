import { expect, test } from "bun:test";
import { ConfinedTextFiles } from "../../infrastructure/filesystem/confined-text-files.ts";
import { Registry } from "../../storage/registry.ts";
import { ProjectFileManager } from "../project-file-manager.ts";

const PROJECT = {
  id: "project_demo",
  collection: "active" as const,
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
    manager: new ProjectFileManager(Registry.createNull({ projects: [PROJECT] }), { active: files, test: files, archive: files }),
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

test("patches one exact section and returns only a focused diff", () => {
  // arrange
  const files = ConfinedTextFiles.createNull({
    "demo/backlog.md": "# Backlog\n\n## refactor\n\n- Existing\n\n## fix\n\n- Keep\n",
  });
  const manager = new ProjectFileManager(
    Registry.createNull({ projects: [PROJECT] }),
    { active: files, test: files, archive: files },
  );

  // act
  const result = manager.manage({
    project: "demo",
    relativePath: "backlog.md",
    operation: "patch",
    expectedText: "## refactor\n\n- Existing\n",
    replacementText: "## refactor\n\n- New\n\n- Existing\n",
  });

  // assert
  expect(result.diff).toBe([
    "--- a/demo/backlog.md",
    "+++ b/demo/backlog.md",
    "@@",
    "-## refactor",
    "-",
    "-- Existing",
    "+## refactor",
    "+",
    "+- New",
    "+",
    "+- Existing",
  ].join("\n"));
  expect(result.diff).not.toContain("## fix");
  expect(files.state.changes[0]?.after).toContain("## fix\n\n- Keep\n");
});

test("rejects missing and ambiguous patch targets", () => {
  const { manager } = setup();

  expect(() => manager.manage({
    project: "demo", relativePath: "sequence.md", operation: "patch",
    expectedText: "missing", replacementText: "replacement",
  })).toThrow("was not found");
  expect(() => manager.manage({
    project: "demo", relativePath: "sequence.md", operation: "patch",
    expectedText: "#", replacementText: "##",
  })).not.toThrow();

  const repeated = ConfinedTextFiles.createNull({ "demo/repeated.md": "same\nsame\n" });
  const repeatedManager = new ProjectFileManager(
    Registry.createNull({ projects: [PROJECT] }),
    { active: repeated, test: repeated, archive: repeated },
  );
  expect(() => repeatedManager.manage({
    project: "demo", relativePath: "repeated.md", operation: "patch",
    expectedText: "same", replacementText: "other",
  })).toThrow("ambiguous");
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

test("rejects archived project mutations", () => {
  const files = ConfinedTextFiles.createNull({ "demo/sequence.md": "# Before\n" });
  const manager = new ProjectFileManager(
    Registry.createNull({ projects: [{ ...PROJECT, collection: "archive" }] }),
    { active: files, test: files, archive: files },
  );

  expect(() => manager.manage({
    project: "demo", relativePath: "sequence.md", operation: "update",
    expectedContent: "# Before\n", content: "# After\n",
  })).toThrow("Archived project files are read-only");
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
