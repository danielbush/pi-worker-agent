import { expect, test } from "bun:test";
import { WorktreeEditor } from "../worktree-editor.ts";

test("opens a derived worktree with EDITOR", () => {
  // arrange
  const editor = WorktreeEditor.createNull("code", "/usr/local/bin/code", 4321);

  // act
  const launch = editor.open("/worktrees/job_implement");

  // assert
  expect(launch).toEqual({
    editor: "code",
    executable: "/usr/local/bin/code",
    worktreePath: "/worktrees/job_implement",
    pid: 4321,
  });
  expect(editor.state).toEqual([launch]);
});

test("reports helpful EDITOR configuration failures", () => {
  // arrange
  const missing = WorktreeEditor.createNull("", "", 1);
  const arguments_ = WorktreeEditor.createNull("code --wait", "/usr/local/bin/code", 1);
  const unavailable = WorktreeEditor.createNull("missing-editor", "", 1);

  // act / assert
  expect(() => missing.open("/worktree")).toThrow("EDITOR is not set");
  expect(() => arguments_.open("/worktree")).toThrow("EDITOR must name one executable without arguments");
  expect(() => unavailable.open("/worktree")).toThrow("EDITOR executable was not found in PATH");
});
