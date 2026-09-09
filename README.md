# prime-worker

A manager agent for delegating coding work, built as Markdown instructions for the
existing Prime Agent CLI. There is no new agent loop, CLI, scheduler, or
project-management system here — just a skill that turns a normal Prime Agent session
into a manager that delegates to workers and keeps track of them.

You say what you want in your own words:

```text
get grok to implement demo 2 in notes.md
get sol to review grok's work
get grok to process sol's review
```

The manager resolves the alias to a model and reasoning level, launches a worker,
records the request and the worker's session identity, and relays the result back.

## Contents

| File | Purpose |
| --- | --- |
| [bin/prime-worker](bin/prime-worker) | The CLI: launches Prime Agent here with the manager active. |
| [models.toml](models.toml) | Agent aliases: model, reasoning, harness, and per-role overrides. The one file you edit. |
| [skills/manager/SKILL.md](skills/manager/SKILL.md) | Interpret requests, delegate, track sessions, route follow-ups, report. |
| [skills/external-harnesses/SKILL.md](skills/external-harnesses/SKILL.md) | Launch and resume Codex, Cursor, and Claude Code. |
| [skills/external-harnesses/references/](skills/external-harnesses/references/) | One verified reference per external CLI. |

Keep these here. Nothing needs to be copied into your project, and your project's
`AGENTS.md` does not need to change.

## Prerequisites

- Prime Agent installed and authenticated (`prime-agent`, verified with `0.9.3`).
- A worker model your account can reach. Check with `prime-agent model list grok-4.6`
  and `prime-agent model list gpt-5.6-sol`.
- Only if you want to use an external harness, its CLI installed and logged in:
  `codex login`, `cursor-agent login`, or `claude`.

## Launch from your codebase

Put `bin/prime-worker` on your PATH once (symlink it wherever you keep local
binaries — the script resolves its own repo through the symlink):

```bash
ln -s /path/to/prime-worker/bin/prime-worker ~/.local/bin/prime-worker
```

Then, in whatever project you want the work done in:

```bash
cd /path/to/your-project
prime-worker
```

That opens the normal interactive Prime Agent UI with the manager already active. Talk
to it:

```text
get grok to explain what demo 2 in notes.md is asking for
get grok to implement demo 2 in notes.md
get sol to review grok's work
get grok to process sol's review
```

Any `prime-agent` flag passes straight through — `prime-worker --resume`,
`prime-worker --model ...`, and so on.

To use a different alias configuration for a run:

```bash
prime-worker --models ./team-models.toml
```

`--models` is the script's own flag (it defaults to this repo's `models.toml`, and is
handed to the manager as `$PRIME_WORKER_MODELS`); everything else is Prime Agent's.

What the script does for you, and why each part matters:

- **Loads every skill in this repo** by absolute path, one `--skill` per directory with
  a `SKILL.md`. Skills you add here are picked up with no further setup.
- **Sends `/skill:manager` as the first message.** `--skill` only puts a skill's
  metadata in the startup prompt; it does not activate the instructions. Without this
  you would get an ordinary Prime Agent session. (Pass your own `--` message and the
  script steps aside — start it with `/skill:manager` yourself.)
- **Runs in your current directory**, not in prime-worker, so your project's
  `AGENTS.md` and its own skills load as usual. Skill discovery stays on.
- **Stays interactive.** Do not reach for `-p` / `--print`, `--mode json`, or
  `--no-session`: those are one-shot, client-owned sessions, and when the turn ends the
  worker is removed and its RLM children are cancelled mid-task. Only an interactive
  session gets a resident, daemon-backed worker that outlives the turn. This is
  verified behaviour — a delegated child killed this way reports `status='error'`.

The manager reads `$PRIME_WORKER_MODELS`, falling back to this repo's `models.toml`,
so it does not care how your project is laid out.

Your work document can be called anything and structured however you like. "demo 2" is
a reference the manager resolves inside the document you name; it is not a required
format.

## Resume

The session is daemon-backed. Closing the terminal detaches the client; the worker,
its Python kernel, and its RLM children keep running.

```bash
prime-agent list                    # find the agent
prime-agent attach <agent>          # reattach the UI
prime-agent rename <agent> manager  # give it a stable name first, if you like
```

To come back to a session whose worker has stopped, resume the transcript from the same
project directory, with the same `--skill` flags:

```bash
cd /path/to/your-project
prime-worker --resume
```

Resume the **original** manager session. A new manager session does not inherit the
children of an old one. On restore, the manager reads its request record and reconciles
it against `rlm.list_subagents()` (native) or the harness's own session list (external)
before telling you anything is still running.

## What the manager writes

One Markdown file, in the session's own artifact directory:

```text
~/.prime/agent/session-artifacts/<root-session-id>/manager/requests.md
```

It holds your wording, the source reference, the resolved harness/model/reasoning, the
worker's identity, status, and result, plus links between related requests such as an
implementation and its review. Nothing is written into your repository — no tickets, no
plan files, no work-tracking directory.

## Delegation model

- **Native workers** are Prime Agent RLM children: one child per request, with a
  readable name, an exact model selector, and a reasoning level. They are addressable
  for follow-ups for as long as the manager session is open, so "get grok to process
  sol's review" goes back to the original grok worker in its original session.
- **External workers** are ordinary CLI invocations of Codex, Cursor, or Claude Code.
  The manager captures the harness's own session ID and resumes through that harness's
  CLI. An external session is not an RLM child and never appears in
  `rlm.list_subagents()`.

Multiple workers may run in the same checkout, including when their edits could
interfere. There is no locking or automatic isolation. If you want isolation, ask for a
worktree and the manager will use a tool such as `wt` and launch the worker there.

## Verified

Checked on 2026-09-09 against `prime-agent 0.9.3`, `codex-cli 0.153.4`,
`cursor-agent 2026.09.02-c22c1a3`, and `claude 2.1.266`:

- Both skills load from absolute `--skill` paths into a session running in a separate
  project; `/skill:manager` activates the manager, the config resolves relative to
  the skill, and the project's own `AGENTS.md` still applies.
- Alias defaults resolve to real selectors via `rlm.find_models()`:
  `openrouter/x-ai/grok-4.6` and `openai-codex/gpt-5.6-sol`. (Verified while these lived
  in `DEFAULTS.md`; the values are unchanged in `models.toml`, but the TOML path itself
  has not been exercised in a live session.)
- The manager writes and reads its `requests.md` record, reconciles it against
  `rlm.list_subagents()`, and reports a failed worker as failed instead of quietly
  relaunching it.
- Codex, Cursor, and Claude Code each launch, return a real session ID, and resume that
  same session with its context intact.
- Claude Code does not read `AGENTS.md`; its reference documents the required prompt
  preamble. Codex and Cursor read it themselves.

Known limitations, all recorded in the references:

- `codex exec resume` accepts neither `-C` nor `-s`; set the working directory on the
  subprocess and the sandbox with `-c sandbox_mode=`.
- Cursor requires `--trust` for a directory it has not seen before, and encodes the
  reasoning level in the model name rather than a separate flag.
- Codex may not re-apply an `AGENTS.md` output convention on a resumed turn; restate
  what matters in the follow-up.
