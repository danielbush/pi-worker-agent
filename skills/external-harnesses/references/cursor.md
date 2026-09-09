# Cursor Agent

Verified against `cursor-agent 2026.09.02-c22c1a3` on 2026-09-09.

- Executable: `cursor-agent`
- Auth: `cursor-agent login` (or `CURSOR_API_KEY`).
- Loads `AGENTS.md` itself. No preamble needed — verified.

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
- Pass the assignment on stdin (`... - < assignment.txt`). Cursor accepts the prompt as a
  positional argument, but stdin avoids any shell interpolation of the assignment text.

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

## Resume

```bash
cursor-agent -p --output-format json --trust --resume <session_id> [--mode ...] -
```

Verified: the resumed run returns the same `session_id` and retains the previous turn's
context. Run it with the same working directory as the launch.
