# OpenAI Codex

Verified against `codex-cli 0.153.4` on 2026-09-09.

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

`--json` writes JSONL events to stdout. The first line is:

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
