# prime-worker

A manager agent that delegates coding work to other agents. It is Markdown
instructions for the existing Prime Agent CLI — no new agent loop, scheduler, or
project-management system.

You talk to it in your own words:

```text
get grok to implement demo 2 in notes.md
get sol to review grok's work
get grok to process sol's review
```

It resolves the name to a model and harness, launches a worker, tracks it, and relays
the result. It does not investigate, plan, or rewrite what you asked for.

## Setup

You need Prime Agent installed and authenticated, plus the CLI of any external harness
you use (`codex login`, `cursor-agent login`, `claude`).

Put the CLI on your PATH:

```bash
ln -s /path/to/prime-worker/bin/prime-worker ~/.local/bin/prime-worker
```

## Use

```bash
cd /path/to/your-project
prime-worker
```

That opens the normal interactive Prime Agent UI with the manager active, in your
project, so its `AGENTS.md` and skills load as usual. Then just talk to it.

### Two modes

**`PROJECT_MODE`** is the above: launch inside a project, and that project is where all
the work happens.

**`HUB_MODE`** lets one session drive several projects. Put a `workspaces.toml` in a
folder and launch from there:

```toml
[workspaces]
api = "/path/to/api"
web = "/path/to/web"
```

```bash
cd ~/work        # the folder holding workspaces.toml
prime-worker
```

Now you name the project: "get grok to implement demo 2 in api". Worktrees are not
configured here — they are discovered with `git worktree list` when needed.

The mode is decided by whether `workspaces.toml` is in the directory you launch from.
See [workspaces.example.toml](workspaces.example.toml).

Prime Agent flags pass through (`prime-worker --resume`, `--model ...`). The script's
own flag is `--models <path>` to use a different alias file. Without it, a `models.toml`
in the directory you launch from is used, else this repo's.

Do not use `-p` / `--print` / `--mode json`: those are one-shot sessions that get torn
down at the end of the turn, cancelling any worker mid-task.

## Configuring agents

[models.toml](models.toml) is the only file you edit. It is keyed by harness, then
agent:

```toml
[defaults]
grok = "cursor"        # the harness grok uses unless you say otherwise

[cursor.grok]
default   = "high"     # the effort used unless you name another
high      = "cursor-grok-4.6-high"
high-fast = "cursor-grok-4.6-high-fast"   # used when you say "fast"

[codex.sol]
default = "medium"
medium  = "gpt-5.6-sol"
high    = "gpt-5.6-sol"
```

Say a harness or an effort to override the default for one request — "get sol high to
review this", "get grok to implement demo 2 with codex". Anything not listed is not
configured: the manager says so rather than assembling a model name.

### The author's setup

The manager itself runs on **deepseek v4 flash 0731 at high** — a cheap, fast model,
because the manager only routes and records; it never does the work. That comes from
Prime Agent's own default model, so nothing here sets it.

Work is passed out to external harnesses:

| Say | Harness | Model |
| --- | --- | --- |
| `grok` | Cursor | `cursor-grok-4.6-high` (`grok fast` for the fast tier) |
| `sol` | Codex | `gpt-5.6-sol` at medium |
| `astra` | Codex | `gpt-6-astra` at low |
| `opus` | Claude Code | `claude-opus-5` at high |
| `fable` | Claude Code | `claude-fable-5-1` at high |

Plus native workers for `kimi`, `deeppro`, `deepflash`, and `glm`, which run as Prime
Agent children rather than a separate CLI.

## How work is tracked

The manager keeps one Markdown file in its own session directory
(`~/.prime/agent/session-artifacts/<session-id>/manager/requests.md`) holding your
wording, the worker's identity, status, and result. Nothing is written into your
repository.

Native workers are Prime Agent RLM children, addressable for follow-ups while the
manager session is open — so "get grok to process sol's review" reaches the original
worker in its original session. External workers are CLI invocations; the manager
captures the harness's own session ID and resumes through that CLI.

Nothing blocks. A launch ends the turn, and you keep talking. Native results arrive by
agent message; external workers are checked by a single one-minute heartbeat that stays
silent until something finishes.

Several workers can run in the same checkout, with no locking. Ask for a worktree if you
want isolation.

## Resume

Closing the terminal detaches the client; the worker and its children keep running.

```bash
prime-agent list
prime-agent attach <agent>
```

If the worker has stopped, `prime-worker --resume` from the same project. Resume the
**original** manager session — a new one does not inherit its children. On restore the
manager reconciles its record against the live registry before claiming anything is
still running.

## Verified

Last checked 2026-09-10. Harness CLIs ship often, so treat these as "true when
tested" rather than permanent, and re-verify anything that matters:

- Skills load, the manager activates, and the project's own `AGENTS.md` still applies.
- The full chain against a real checkout: implement, review by a second worker, then
  routing the review back to the *same* worker rather than a replacement.
- The request record is written, reconciled against the live registry after reattach,
  and a failed worker is reported as failed rather than quietly relaunched.
- Codex, Cursor, and Claude Code each launch, return a real session ID, and resume it
  with context intact.
- Cursor takes its prompt positionally and has no stdin form; a stdin prompt is silently
  never delivered and the run still reports success.

Not yet exercised in a live session: the `models.toml` read, the one-minute heartbeat
for external workers, and the interactive resident-worker path (demos ran over RPC).

Known limitations:

- Claude Code does not read `AGENTS.md`; its reference adds a prompt preamble.
- `codex exec resume` takes neither `-C` nor `-s`: set the subprocess working directory
  and use `-c sandbox_mode=`.
- Cursor needs `--trust` for an unseen directory, and bakes the reasoning level and fast
  tier into the model name.
