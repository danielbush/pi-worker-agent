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
(`mise.toml`) and wraps common commands as [go-task](https://taskfile.dev/)
tasks (`task --list` shows them).

Then say **"onboard me"**. The manager walks you through setup
conversationally — copying the example policies, checking which models you
can access, and shaping things to how you work.

The broad shape: the manager runs on **policy documents** — `AGENTS.md` plus
`policies/` (see the [`examples/policies/`](examples/policies/README.md)
README for what to copy and adapt) — and tracks work in **runs**, all plain
files. Each managed project gets a
directory:

```
TASKS.md             global dashboard across all projects (generated)
projects/<name>/
  README.md          project context the manager wrote with you
  state.json         machine-readable run state (source of truth)
  TASKS.md           per-project dashboard — render the markdown in your editor
  runs/...
```

A run is a dated directory of numbered markdown files. Jobs and reviews append
in order, so iteration is just the next number:

```
projects/<name>/runs/2026-09-07-1501-build/
  00-task.md         spec the manager wrote and you approved
  01-plan.md         planner's report
  02-implement.md    implementer's report
  03-review.md       reviewer's verdict (PASS/FAIL)
  04-implement.md    revision attempt, if the review failed
  05-review.md       re-review
  06-review.md       your review — tell the manager your feedback in chat and
                     it writes it up; a user review is just another review
  07-implement.md    the revision your review asked for
```

Every file starts with frontmatter so attribution survives without the state:

```
---
author: sol (codex, gpt-5.6-sol, medium)
role: reviewer
date: 2026-09-07
---
```

## Why Prime Agent

Prime Agent's [RLM](https://alexzhang13.github.io/blog/2025/rlm/) runtime (recursive language model — the agent's tools execute in a persistent Python REPL it can program against) is what makes this manager shape practical. It has
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

- **Manager**: Prime Agent running `moonshotai/kimi-k3` (Kimi K3) at medium
  thinking as the default model, configured in
  `~/.prime/agent/settings.json` (`defaultProvider`, `defaultModel`,
  `defaultThinkingLevel`). Chosen because
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

OpenRouter hosts the same model through multiple upstream providers, and any one
route can be slow or down (modal is quite fast and reliable but will issue
429's; other providers in openrouter may silently hang and may or may
not recover). Define one custom provider with a fallback chain per model via
`openRouterRouting.order` — the first route is tried first, and
`allow_fallbacks: false` keeps the chain to exactly the routes you list:

```json
"providers": {
  "openrouter-routed": { "baseUrl": "https://openrouter.ai/api/v1", ...,
    "models": [{ "id": "moonshotai/kimi-k3",
      "compat": { "openRouterRouting": { "order": ["modal/mxfp4", "morph/fp4"],
        "allow_fallbacks": false } } }] }
}
```

Name the custom provider key something that does not collide with the built-in
`openrouter` provider (e.g. `openrouter-routed`) — a colliding key silently
drops your custom model list (verified 2026-09-07). Profiles in
`policies/WORKFLOWS.md` then just name the model, e.g.
`openrouter-routed/moonshotai/kimi-k3`; routing lives in one place.

**Caveat:** the chain fails over on fast errors (429, provider down), not on
silent hangs — a stalled stream stays stalled. Use a new or reloaded Prime
Agent session after editing `models.json`.

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
