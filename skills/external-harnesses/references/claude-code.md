# Claude Code

Behaviour last verified 2026-09-09 against `claude 2.1.266`. Re-check with
`claude --version` if something here does not match.

- Executable: `claude`
- Auth: `claude` interactively once, or `ANTHROPIC_API_KEY`.
- **Does not load `AGENTS.md`.** It discovers `CLAUDE.md`, not `AGENTS.md`. See
  [Project instructions](#project-instructions) — this is required, not optional.

## Launch

```bash
claude -p --output-format json \
  --model <model> \
  --effort <low|medium|high|xhigh|max> \
  --permission-mode <plan|acceptEdits|auto|bypassPermissions> \
  --permission-prompts none
```

- `-p` is non-interactive print mode; `--output-format json` gives one JSON object.
- Pass the assignment on stdin (`... < assignment.txt`); `claude -p` reads the prompt from
  stdin when no positional prompt is given.
- `--permission-prompts none` denies anything that would prompt, instead of hanging
  waiting for an answer that nobody can give. Always set it for an unattended run.
- `--permission-mode plan` for investigation, review, and planning (read-only);
  `acceptEdits` for implementation.
- Set the project directory as the subprocess working directory.
- `--model` takes an alias (`opus`, `sonnet`, `fable`, `haiku`) or a full model name
  (`claude-opus-5`). `--effort` is separate from the model.

## Project instructions

Claude Code will not read `AGENTS.md` on its own — verified: an otherwise identical run
ignored a mandatory instruction in `AGENTS.md`, and followed it once the prompt said to
read the file.

Prefix every assignment (launch and resume) with:

```text
Before anything else, read ./AGENTS.md and follow it for the whole session.
```

`--append-system-prompt "..."` alone was **not** sufficient on a resumed session in
testing. Use the prompt preamble.

## Running it async

Use `--output-format stream-json --verbose` for a background run. It emits JSONL as the
work happens, and the first event carries the session ID:

```json
{"type":"system","subtype":"init","session_id":"b61d986e-...","...":"..."}
```

Later events are `assistant` (messages and tool calls) and `user` (tool results), ending
with `result`. Plain `--output-format json` emits a single object only when the run
finishes, so it cannot be used for an async launch.

Redirect the stream to the worker's file in the manager's artifact directory, record the
session ID from the first line, and inspect the file on later ticks.

When passing the prompt positionally rather than on stdin, add `< /dev/null` — otherwise
Claude Code waits ~3s for stdin and warns before proceeding.

## Session ID, result, and status

```json
{"type":"result","subtype":"success","is_error":false,"num_turns":2,
 "result":"...final message...",
 "session_id":"e0a3bd28-bd44-4306-9b8d-613a41e16ec3"}
```

`session_id` is the session ID. Treat the run as failed if the exit status is non-zero,
`is_error` is `true`, or `subtype` is not `success`.

## Resume

```bash
claude -p --resume <session_id> --output-format json \
  --permission-mode <...> --permission-prompts none
```

Verified: the resumed run returns the same `session_id` and retains the previous turn's
context.

Do not pass `--fork-session` for a continuation — it deliberately creates a new session
ID, which breaks the recorded worker identity.

## Interactive resume (handing the session to the user)

```bash
claude --resume <session_id>
```

No `-p`, no `--output-format`: this opens the interactive UI on that session, and the
user's turns are in context on your next `claude -p --resume`. Same `--fork-session`
rule — it would break the recorded identity.

Permission mode comes from the user's own settings, not the `--permission-mode` you
launched with. Say so when you hand it over.

The transcript is on disk at `~/.claude/projects/<cwd-slug>/<session_id>.jsonl` if you
need to reconstruct what happened, but asking the worker is cheaper.
