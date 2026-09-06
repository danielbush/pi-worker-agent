---
name: show-managed-file
description: Open an authoritative Prime Worker Agent file in the user's GUI editor. Use this skill whenever the user asks to "show me", "open", "load", or "bring up" a managed task, original brief, model configuration, workflows, architecture, manager policy, project context, state, or task index—especially when they mention VS Code, Cursor, Zed, Sublime Text, an IDE, or "my editor". Infer the GUI editor from conversation context first; never create a viewing copy, expose credentials, or launch a terminal editor.
compatibility: Requires a Prime Worker Agent repository and either a GUI editor CLI or macOS `open -a` application name.
---

# Show an authoritative managed file

Open the real source file in the user's GUI editor. Do not create a temporary
copy or substitute a worker prompt/report for the original task.

## Supported targets

| User asks for | Target |
|---|---|
| task, original task, original brief | Current or named run's `task.md` |
| models, model configuration | `~/.prime/agent/models.json` |
| workflows | Repository `WORKFLOWS.md` |
| architecture | Repository `docs/ARCHITECTURE.md` |
| policy, manager instructions | Repository `AGENTS.md` |
| project context | `projects/<name>/README.md` |
| state | `projects/<name>/state.json` |
| project tasks/index | `projects/<name>/TASKS.md` |
| root tasks/index | Repository `TASKS.md` |

Never open `auth.json`, credentials, raw harness logs, or another sensitive file
through a vague “show me” request. Require a separate explicit request and apply
the relevant security policy.

## Choose the editor

1. Prefer a GUI editor explicitly named in the conversation. Examples: “code”
   or “VS Code” → `code`; “Cursor” → `cursor`; “Zed” → `zed`.
2. Otherwise use a clear GUI integrated-terminal signal.
3. Otherwise inspect available GUI commands. If several are plausible, ask.
4. Never launch terminal editors such as `vi`, `vim`, `nvim`, `nano`, `emacs`,
   `helix`, `hx`, `kak`, or `micro`.

Use `--editor COMMAND` for a GUI CLI. On macOS use
`--editor-app "Application Name"` when necessary.

## Procedure

Run the bundled resolver from the repository root:

```bash
python3 .agents/skills/show-managed-file/scripts/show_managed_file.py \
  --root /absolute/prime-worker-agent \
  --target task \
  --project PROJECT \
  --run-id RUN_ID \
  --editor code
```

Only task targets use `--run-id`. Project-specific targets use `--project`.
Omit `--run-id` to select the project's latest active run. If project or editor
selection is ambiguous, ask instead of guessing. Use `--dry-run` to print the
resolved file and launch command without opening anything.

After success, tell the user which authoritative path and editor were used.

## Safety

- Resolve paths without printing file contents into model context.
- For run tasks, use the `task_file` recorded in state and enforce containment
  inside the selected project directory.
- Open `models.json`; never open `auth.json` as a substitute.
- Opening `state.json` in the user's editor is allowed, but do not print the
  whole unbounded file into the conversation.
- Never modify the selected file, state, project code, or Git state.
- Never create a `/tmp` viewing copy.
- Never infer a terminal editor from `$EDITOR` or `$VISUAL`.
