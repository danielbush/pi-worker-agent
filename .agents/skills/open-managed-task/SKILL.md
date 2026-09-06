---
name: open-managed-task
description: Open the authoritative original or current managed task.md in the user's GUI editor. Use this skill whenever the user says "open the task", "open the original task", "load the task in my editor", "show the brief", names a GUI editor such as VS Code, Cursor, Zed, Sublime Text, or an IDE, or corrects a temporary-copy/brief misunderstanding. Infer the editor from explicit conversation context first; never silently choose among several plausible editors and never launch a terminal editor.
compatibility: Requires a Prime Worker Agent repository with projects/<name>/state.json and either a GUI editor CLI or macOS `open -a` application name.
---

# Open a managed task in the user's GUI editor

Open the authoritative manager-owned `task.md`. Do not create a temporary copy,
open a report instead, or treat the in-memory worker prompt as the original task.

## Choose the editor

Gauge the user's editor before launching anything:

1. Prefer an editor the user explicitly named in the current conversation.
   Examples: “code” or “VS Code” → `code`; “Cursor” → `cursor`; “Zed” →
   `zed`.
2. Otherwise use a clear environment signal, such as an integrated terminal
   belonging to a GUI editor.
3. Otherwise inspect the GUI editor commands available on `PATH`. If exactly one
   plausible command exists, use it. If several exist, ask the user which one
   they use.
4. Skip terminal editors. Never launch `vi`, `vim`, `nvim`, `nano`, `emacs`,
   `helix`, `hx`, `kak`, or `micro` from this skill.

Use `--editor COMMAND` for a GUI editor CLI. On macOS, use
`--editor-app "Application Name"` when the editor has no convenient CLI.

## Procedure

1. Resolve the Prime Worker Agent repository root and the project/run named or
   implied by the conversation. Prefer explicit context over guessing.
2. Run the bundled resolver from the repository root:

   ```bash
   python3 .agents/skills/open-managed-task/scripts/open_managed_task.py \
     --root /absolute/prime-worker-agent \
     --project PROJECT \
     --run-id RUN_ID \
     --editor code
   ```

   Omit `--run-id` to select that project's most recent active run. Omit
   `--project` only when the repository has one managed project; otherwise ask
   which project the user means.
3. If task or editor resolution is uncertain, use `--dry-run` first. It prints
   the selected task and launch command without opening the editor.
4. On success, tell the user which authoritative repository path and editor were
   used.

## Safety

- Read `state.json` in code without printing it whole.
- Select the `task_file` recorded on the run and verify its resolved path remains
  inside the selected project control directory.
- Never modify `state.json`, `TASKS.md`, `history.jsonl`, `task.md`, or project
  code.
- Never create a `/tmp` viewing copy.
- Never infer a terminal editor from `$EDITOR` or `$VISUAL`.
- If project, run, or GUI editor selection remains ambiguous, stop and ask one
  short clarification question.
