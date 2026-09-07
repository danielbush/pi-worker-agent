# Prime Worker Agent

A directory you run [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
in that turns it into a manager rather than a coder. It talks to you, and
delegates the actual work to worker agents operating on projects that live
elsewhere on disk.

You describe what you want in plain language. The manager picks a workflow,
spawns one worker per job, checks each result before moving on, and reports
back between jobs. Adding a new workflow means editing markdown, not code.

Prime Agent auto-loads `AGENTS.md` and `.agents/skills/` from the directory
you launch it in — so this repository *is* the manager's configuration. Run
the agent here and it comes up as a manager; run it inside one of your
projects and it comes up as an ordinary coding agent.

## Getting started

> ⚠️ **Warning: first-time use is untested.** The maintainer built this
> alongside his own setup, so fresh-clone onboarding likely has rough edges.
> Expect to bump into them; please report what broke.

Install [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) (`task install`
runs the official install script), clone this repository, and run the agent
in it:

```bash
git clone <this-repo> prime-worker-agent
cd prime-worker-agent
mise install    # uv and go-task — see mise.toml
task install    # installs Prime Agent (official install script)
task start      # runs the Prime Agent manager
```

This repository uses [mise](https://mise.jdx.dev/) to pin its tools
(`mise.toml`: uv for Python, and go-task). Install mise, then
`mise install` in the repo. Common commands are wrapped as
[go-task](https://taskfile.dev/) tasks: `task start` runs the manager, and
`task test` runs the tools/ test suite and static checks (`uv run pytest`,
`uv run ty check`, `uv run ruff check`).

Then say **"onboard me"**. The manager checks whether `policies/` is set up,
offers to copy `examples/policies/` into it, checks which models you have
access to, shapes workflows to how you work, and reads your first project to
draft its context. It'll tell you what to `/login` to if a model you want
isn't configured.

## Why Prime Agent

Prime Agent's RLM runtime is what makes this manager shape practical. It has
two layers: the agent loop is TypeScript (streaming, turns, tool routing),
while tool calls execute in a **persistent Python REPL**. State, indexes, and
parsed reports live in kernel variables the manager can slice and query
instead of re-reading them into a context window; process handles survive
across turns. The manager spawns workers as native subagents (`rlm()`),
watches them with `agent_observe`, talks to them with `agent_message`, and
compacts its own context when it fills — so long orchestration sessions don't
degrade.

External harnesses (cursor-agent, codex) trade some of that away. They are
ordinary processes: no agent messaging, no observation — the manager keeps a
process handle, captures the harness's JSONL event stream to a durable log,
and runs a heartbeat that polls the log and reports stalls or completion.
That is enough to supervise them reliably, but it is manual plumbing compared
to what `rlm()` gives you for free.

## The maintainer's setup (non-authoritative)

How the author happens to run this today — documentation of one working
setup, not instructions:

- **Manager**: Prime Agent running `moonshotai/kimi-k3` (Kimi K3) as the
  default model, configured in `~/.prime/agent/settings.json`. Chosen because
  it's easy to talk to and has a large context window — both valuable in the
  manager seat, which spends its life in conversation and carries run state
  around.
- **Workers**: a mix of RLM-native (GLM, Kimi via OpenRouter routes) and
  external harnesses — `cursor-agent` (Grok) and `codex` (GPT-5.6 Sol). No
  settled doctrine here; the open question is whether to spend on
  expensive planners with cheaper/faster builders, or the reverse. External
  harnesses are attractive partly for economics — ChatGPT/Cursor
  subscriptions are heavily subsidised relative to API pricing — and partly
  for whatever the harness itself adds (tooling, caching, its own agent
  loop). RLM-native buys tighter supervision (messaging, observation) as
  described above.

### Provider routing via `~/.prime/agent/models.json`

OpenRouter hosts the same model through multiple upstream providers, and any
one route can be slow or down (will issue 429's or sometimes hang).
You can represent each openrouter / provider combo as a *separate
Prime Agent provider* pinned with `openRouterRouting.only` and
`allow_fallbacks: false`:

```json
"providers": {
  "openrouter-modal": { "baseUrl": "https://openrouter.ai/api/v1", ...,
    "models": [{ "id": "moonshotai/kimi-k3",
      "compat": { "openRouterRouting": { "only": ["modal/mxfp4"],
        "allow_fallbacks": false } } }] },
  "openrouter-morph": { ... "only": ["morph/fp4"] ... }
}
```

Profiles in `policies/WORKFLOWS.md` then name the route explicitly, e.g.
`openrouter-modal/moonshotai/kimi-k3` with route `modal/mxfp4`. Changing route
= changing profile, which is a one-line per-run choice.

**Operational note:** OpenRouter routes do drop out mid-session. When a
worker stalls or errors on a dead route, stop it (left-arrow in the TUI to
interrupt), and re-run the session — sometimes switching to the sibling
provider (modal ↔ morph). It happens often enough to be expected, not
alarming. Use a new or reloaded Prime Agent session after editing
`models.json`.

## Learn more

Two kinds of files, two levels of permission:

- **The kernel — not yours to change.** `AGENTS.md` is the manager's operating
  policy, auto-loaded into its prompt. It's intended to be stable across
  users: the ownership rules, run lifecycle, and worker supervision protocol
  that make the whole thing hold together. Treat changes to it as changes to
  the project itself (a pull request, not a preference).
- **The policies — completely yours.** Everything under `policies/`
  (WORKFLOWS.md: models, job types, workflows; CODE.md: coding standards) is
  user configuration. Copy the examples and reshape them freely; the manager
  reads them at runtime and never edits them itself.

More detail:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data flow, storage, outputs,
  ownership, and the configuration entity diagram.
- `SETUP.md` — this repository's own tooling (mise + uv) for working on
  `tools/`.
