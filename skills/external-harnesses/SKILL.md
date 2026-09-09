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

**Never interpolate the assignment into the command string.** Assignments contain
quotes, backticks, newlines, and `$`. The kernel's `bash()` takes a command string and
nothing else — there is no `input=` and no `cwd=` parameter.

How the assignment is delivered differs by harness, and getting it wrong fails silently:

| Harness | Delivery |
| --- | --- |
| Codex | stdin, with a trailing `-` |
| Claude Code | stdin |
| Cursor | **positional argument only** — it has no stdin form, and a trailing `-` is read as a literal message |

For the two stdin harnesses, write the assignment to a file and redirect it in:

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

**Always use the streaming output format.** All three harnesses emit JSONL where the
first event carries the session ID and later events show the work as it happens. The
non-streaming format emits one object only when the run *finishes*, so an async launch
would have no session ID for its entire duration.

| Harness | Streaming flag | First event | Progress events |
| --- | --- | --- | --- |
| Codex | `--json` | `thread.started` → `thread_id` | `item.started` / `item.completed` (`command_execution` with `exit_code`, `agent_message`) |
| Cursor | `--output-format stream-json` | `system` → `session_id` | `thinking`, `assistant`, `tool_call` |
| Claude Code | `--output-format stream-json --verbose` | `system`/`init` → `session_id` | `assistant`, `user` (tool results) |

All three end with a terminal event carrying the result and usage: `turn.completed`
(Codex) or `result` (Cursor, Claude Code).

**Capture the session ID and persist it immediately**, from that first event, before
doing anything else.

Redirect each worker's stream to its own file in the manager's artifact directory, named
after the worker's handle — never in the consumer's repository:

```python
import os, pathlib

work = pathlib.Path(os.environ["RLM_SESSION_DIR"]) / "manager" / "workers"
work.mkdir(parents=True, exist_ok=True)
out = work / f"{worker_handle}.jsonl"
err = work / f"{worker_handle}.err"
```

That file is how you inspect a running worker: read the events appended so far to see
what it is doing, and read the terminal event once `handle.poll()` shows it exited. A process ID, a log filename, or "the most recent
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

**And do not stop at the status flags.** A run whose assignment never arrived still
reports success. Read the result text and confirm it addresses the assignment; when
edits were expected, confirm the files changed. Token usage is the cheapest tell — a
worker that received a real assignment consumes thousands of input tokens, not
hundreds.

**Never block the manager on an external worker.** An external CLI has no
`agent_message`, so nothing pushes its result back to you — but that is not a reason to
sit in a foreground `await`. Start it as a background handle, end the turn, and let a
heartbeat bring you back.

```python
handle = bash(command)          # no await
handle.pid                      # touching the handle first makes it survive the turn
```

Record `handle` alongside the request. `await handle` only when `handle.poll()` already
shows it finished; awaiting a running handle blocks the turn, which is the thing to
avoid.

**Poll with a 1-minute heartbeat, not a loop.** When you launch the first external
worker, create one heartbeat for all of them:

```python
await rlm_heartbeat.create(
    "Silently check every running external worker with handle.poll(). If none have "
    "finished, say nothing at all and end the turn. For any that finished: read its "
    "output file, relay the result, and update the request record. Delete this "
    "heartbeat once no external worker is still running.",
    interval="1m",
    label="external-workers",
    delivery_mode="follow_up",
)
```

`follow_up` so the check waits for whatever you are doing rather than interrupting the
user mid-turn. One heartbeat covers every external worker — do not create one per
worker.

**A tick with nothing to report prints nothing.** Do not announce that you checked, do
not say "still running", do not summarise progress. The user is reading their terminal;
a minute-by-minute status trickle is noise. Speak only when a worker has actually
finished, failed, or needs a decision from the user — or when they ask.

On each tick: check every recorded handle, relay anything that finished, and when none
are still running, `await rlm_heartbeat.delete(<id>)` so it stops firing. Recover the id
with `await rlm_heartbeat.list()` if you no longer have it. Leaving a heartbeat running
with nothing to check wakes the session every minute for nothing.

A worker that is still running is not a failure. Say it is still running and end the
turn.

## Limitations to state plainly

- An external session is not an RLM child. It never appears in
  `rlm.list_subagents()`, and it is resumed only through its own CLI.
- If a harness cannot expose or resume an exact session, say so. Never present a fresh
  session as a continuation of an earlier one.
- Each harness needs its own authentication. If a launch fails on auth, report it and
  let the user log in — do not attempt to authenticate on their behalf.
