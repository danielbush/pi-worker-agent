# OpenAI Codex

Behaviour last verified 2026-09-09 against `codex-cli 0.153.4`. Re-check with
`codex --version` if something here does not match.

- Executable: `codex`
- Auth: `codex login` (checks with `codex doctor`). A launch fails loudly when
  unauthenticated; report it rather than logging in for the user.
- Loads `AGENTS.md` itself. No preamble needed — verified.

## Launch

```bash
codex exec \
  -C <project-dir> \
  -s <read-only|workspace-write|danger-full-access> \
  -m <model> \
  -c model_reasoning_effort="<minimal|low|medium|high|xhigh>" \
  --json \
  -o <last-message-file> \
  -
```

The trailing `-` makes Codex read the prompt from stdin. Write the assignment to a file
and redirect it (`... - < assignment.txt`) rather than interpolating it into the command;
the kernel's `bash()` has no `input=` parameter.

- `-s read-only` for investigation and review; `-s workspace-write` for implementation.
- `--skip-git-repo-check` only if the project is not a git repository.
- Model and reasoning are separate: `-m` selects the model, `-c model_reasoning_effort`
  selects the effort.

## Session ID

`--json` writes JSONL events to stdout as the run proceeds, so a background launch can
be inspected while it works. The first line is:

```json
{"type":"thread.started","thread_id":"01a083a4-2964-7182-b315-2c2685a0e2fe"}
```

`thread_id` is the session ID. Parse it from that event and record it before anything
else.

## Result and status

- `-o <file>` writes the agent's final message to that file. Read it from there rather
  than reassembling the stream.
- The last `turn.completed` event carries usage. `item.completed` events with
  `item.type == "agent_message"` are the intermediate messages, and
  `item.type == "command_execution"` shows commands with their `exit_code`.
- The process exit status is the launch outcome: `0` on success, non-zero on failure
  (stderr carries the reason).

For an async run, redirect the stream to the worker's file and read it on later ticks:
`item.completed` events with `item.type == "command_execution"` show each command and
its `exit_code`, and `agent_message` items show what the worker said. A passing exit
status is not proof the assignment was done — read those events and check the work.

## Resume

```bash
codex exec resume <thread_id> \
  -c sandbox_mode="<read-only|workspace-write>" \
  --json \
  -o <last-message-file> \
  -
```

**`codex exec resume` does not accept `-C` or `-s`.** Set the project directory as the
subprocess working directory, and set the sandbox with `-c sandbox_mode="..."` instead.
Passing `-C` fails with `error: unexpected argument '-C' found`.

Resume re-emits `thread.started` with the same `thread_id`; confirm it matches what you
recorded. Verified: a resumed session retained the previous turn's context.

Note: the resumed turn does not necessarily re-apply `AGENTS.md` output conventions
that were followed on the first turn. Restate anything that matters in the follow-up.

## Interactive resume (handing the session to the user)

```bash
codex resume <thread_id>
```

`codex resume` (no `exec`) opens the TUI on that thread — same `thread_id`, same
history, and the turns the user adds are in context on your next `codex exec resume`.
Without a session ID it shows a picker instead; always pass the recorded ID.

It takes neither `-s` nor `-m`: the sandbox and model come from the user's
`~/.codex/config.toml`, not from the flags you launched with. Say so when you hand it
over.
