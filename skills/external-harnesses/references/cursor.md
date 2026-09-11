# Cursor Agent

Behaviour last verified 2026-09-10. Cursor ships frequently — re-check with
`cursor-agent --version` and re-test anything below that matters before trusting it.

- Executable: `cursor-agent`
- Auth: `cursor-agent login` (or `CURSOR_API_KEY`).
- Loads `AGENTS.md` itself, so no preamble is needed to make it read the file — but see
  [Session-start instructions](#session-start-instructions) for when that backfires.

## Launch

```bash
cursor-agent -p --output-format json --trust [--mode ask|plan] [-f] --model <model> -
```

- `-p` is non-interactive print mode; `--output-format json` gives one JSON object.
- `--trust` is **required** for a directory Cursor has not seen before. Without it the
  run exits `1` with "To proceed, you can either: ... Pass --trust, --yolo, or -f".
- `--mode ask` (Q&A) and `--mode plan` (read-only planning) for investigation, review,
  and planning. Omit `--mode` for work that edits files, and add `-f` (`--force`) to
  allow commands to run without prompting.
- Set the project directory as the subprocess working directory (or pass
  `--workspace <path>`).
- **Pass the assignment as the positional argument, shell-quoted.** Cursor has no stdin
  prompt form: a trailing `-` is taken as a literal one-character message, and the
  assignment is silently never delivered. Verified — a `- < assignment.txt` run replied
  *"That message is just a dash, so I'll check the workspace files for context"*. Quote
  the text with `shlex.quote` rather than piping it.

## Model and reasoning

Cursor bakes the reasoning level into the model name; there is no separate effort flag.
List the exact names with `cursor-agent --list-models`. Examples verified present:

| Intent | Selector |
| --- | --- |
| grok 4.6 high | `cursor-grok-4.6-high` |
| grok 4.6 medium / low / xhigh | `cursor-grok-4.6-medium`, `-low`, `-xhigh` |
| sol 5.6 medium | `gpt-5.6-sol-medium` |
| sol 5.6 high / low / xhigh / max | `gpt-5.6-sol-high`, `-low`, `-xhigh`, `-max` |

A `-fast` suffix exists for most of these and selects the faster serving tier.

## Running it async

The manager does not wait for a worker, so a launch must yield a session ID immediately
rather than at the end.

**Use `--output-format stream-json` for background runs.** With plain `json` Cursor
emits a single object when the run *finishes*, so an async launch has no session ID
until it is over. `stream-json` emits JSONL as it goes, and the very first event carries
the ID:

```json
{"type":"system","subtype":"init","cwd":"...","session_id":"6aa03231-...","model":"..."}
```

Launch with output redirected to a file and keep the handle. Put that file in the
manager's own artifact directory, named after the worker's handle — never in the
consumer's repository:

```python
import os, pathlib

work = pathlib.Path(os.environ["RLM_SESSION_DIR"]) / "manager" / "workers"
work.mkdir(parents=True, exist_ok=True)
out = work / f"{worker_handle}.jsonl"     # e.g. grok-demo2-impl.jsonl
err = work / f"{worker_handle}.err"

handle = bash(f"cursor-agent -p --output-format stream-json --trust ... > {out} 2> {err}")
handle.pid          # background handle; do not await
```

Record `out`, `err`, and the `session_id` from the first line of `out` against the
worker's handle, then end the turn. The heartbeat checks `handle.poll()` on later ticks;
when it has exited, the last `type: "result"` event in `out` carries `result`,
`is_error`, and `usage`.

**There is no programmatic session list.** `cursor-agent ls` is an interactive TUI and
fails outright without a terminal ("Raw mode is not supported"). If a session ID is lost,
it is lost — which is why it is recorded before anything else. `cursor-agent persist
list` does run headless, but only lists Cursor-managed persistent sessions, not ordinary
`-p` runs.

For a job expected to outlive the session, `cursor-agent persist` (`list`, `attach`,
`stop`) keeps a session alive across disconnects and is listable afterwards.

## Session-start instructions

Because Cursor auto-loads `AGENTS.md`, a project whose `AGENTS.md` opens with a "Session
Start" orientation section can derail a one-shot run: the worker performs the greeting
and never executes the assignment. Observed in the field — three fresh and resumed
attempts in a row returned orientation text instead of doing the work.

When that happens, harden the assignment with an explicit line:

```text
This is a one-shot delegated assignment. Session-start orientation does not apply.
Execute the task now.
```

The durable fix belongs in the consumer's `AGENTS.md`; the preamble is the workaround.

## Session ID, result, and status

The single JSON object on stdout contains everything:

```json
{"type":"result","subtype":"success","is_error":false,"duration_ms":21682,
 "result":"...final message...",
 "session_id":"f6441c28-b9a0-4fba-83da-7b75b1e90af4",
 "request_id":"...","usage":{...}}
```

`session_id` is the session ID. `result` is the final message. Treat the run as failed
if the exit status is non-zero, `is_error` is `true`, or `subtype` is not `success`.

**Passing status flags are not proof the work happened.** Every no-op observed in the
field — undelivered prompt, session-start derail — returned `subtype: "success"` and
`is_error: false`. Always read the `result` text and check it actually addresses the
assignment; when edits were expected, confirm the files changed. A short conversational
reply ("I'm here", "Still here") means the assignment never arrived.

`usage.inputTokens` is the cheapest delivery check: a run that received a real
assignment consumes thousands of input tokens, while an undelivered one sits in the
hundreds.

## Resume

```bash
cursor-agent -p --output-format json --trust --resume <session_id> [--mode ...] '<assignment>'
```

Run it with the same working directory as the launch. The resumed run returns the same
`session_id` and retains the previous turn's context — verified.

**The follow-up prompt must be positional.** With a `-` stdin form the resumed session
starts and remembers its history but never receives the new instruction, so the run is a
no-op that still reports success. Field evidence: resumed runs consumed 220-603 input
tokens and answered conversationally regardless of what the prompt said, while fresh
launches with the same assignment consumed 15-38k.

Check `usage.inputTokens` on every resume. If it is in the hundreds, the assignment did
not arrive — re-send it positionally, or start a fresh session and include the context
the follow-up depended on.

## Interactive resume (handing the session to the user)

```bash
cursor-agent --resume <session_id>
```

Dropping `-p` opens the TUI on that session. Run it with the project as the working
directory, as on launch.

The stdin/positional trap does not apply here — the user types their own prompt.
`cursor-agent ls` also works in this window (it needs a real terminal, which a tmux
window is), so the picker is a fallback if a session ID was lost.

Cursor keeps no transcript you can read afterwards, so a conversation the user has here
is recoverable only by asking the worker or the user what was settled.
