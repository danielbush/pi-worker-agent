---
name: external-harnesses
description: Launch and resume work in an external coding CLI - OpenAI Codex, Cursor Agent, or Claude Code - from the Prime Agent Python kernel, capturing the harness's real session ID so the same session can be continued later. Use when a work request names one of those harnesses instead of a native RLM worker.
---

# External harnesses

Run the harness's installed CLI as an ordinary command from the Python kernel. There is
no SDK integration and no generic adapter; each harness has its own verified procedure.

| Harness | Reference |
| --- | --- |
| OpenAI Codex | [references/codex.md](references/codex.md) |
| Cursor Agent | [references/cursor.md](references/cursor.md) |
| Claude Code | [references/claude-code.md](references/claude-code.md) |

Read the reference for the harness you are using. It has the exact flags, the session
ID location, and the resume command for the version installed here.

## Rules that apply to all three

**Pass the assignment on stdin, never inside the command string.** Assignments contain
quotes, backticks, newlines, and `$`. The kernel's `bash()` takes a command string and
nothing else — there is no `input=` and no `cwd=` parameter — so write the assignment to
a file and redirect it in:

```python
import os, pathlib, shlex

os.chdir(project_dir)            # persists for later bash() calls in this kernel
prompt_file = pathlib.Path(os.environ["RLM_SESSION_DIR"]) / "manager" / "assignment.txt"
prompt_file.parent.mkdir(parents=True, exist_ok=True)
prompt_file.write_text(assignment_text)

result = await bash(f"{cli_command} < {shlex.quote(str(prompt_file))}")
print(result.output)
```

`os.chdir(...)` in the kernel applies to every later `bash()` call, which is how you set
the working directory for a CLI that has no directory flag on resume.

**Capture the harness's own session ID and persist it immediately**, before doing
anything else with the result. A process ID, a log filename, or "the most recent
session" is not a session ID and must not be recorded as one. Store it in the manager's
request record.

**Set the working directory to the consumer project.** Some of these CLIs take a
directory flag on launch but not on resume; the references say which. When in doubt,
set the subprocess working directory.

**Make sure the worker reads the project's instructions.** Codex and Cursor load
`AGENTS.md` themselves. Claude Code does not — its reference gives the required prompt
preamble.

**Check the real outcome.** Read the exit status and the structured result, not just
that the process returned. Report a non-zero exit or an error result as a failure.

**Foreground is enough.** If a job outlives the tool call, keep the execution handle
and the output location and inspect its actual status before retrying. Do not add a
background service for external workers.

## Limitations to state plainly

- An external session is not an RLM child. It never appears in
  `rlm.list_subagents()`, and it is resumed only through its own CLI.
- If a harness cannot expose or resume an exact session, say so. Never present a fresh
  session as a continuation of an earlier one.
- Each harness needs its own authentication. If a launch fails on auth, report it and
  let the user log in — do not attempt to authenticate on their behalf.
