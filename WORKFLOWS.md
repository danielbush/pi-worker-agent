# Workflows

Two things live here: **profiles** (which model does what kind of work) and
**workflows** (which jobs run in what order).

Edit this file to add, remove, or reshape either. No code changes needed. Ask
the manager to help — it can check which models you actually have access to.

## Profiles

A profile names a harness, model, and thinking level. Jobs reference profiles,
so model and harness choices stay in one place.

| Profile | Harness | Model | Thinking | Route | For |
|---|---|---|---|---|---|
| `planner` | `rlm` | `openai-codex/gpt-5.6-sol` | medium | — | Working out approach, weighing options |
| `coder` | `rlm` | `openrouter/z-ai/glm-5.3-flash` | high | `modal/fp8` | Writing the change |
| `reviewer` | `rlm` | `openai-codex/gpt-5.6-sol` | medium | — | Judging whether it's right |
| `quick` | `rlm` | `openrouter/z-ai/glm-5.3-flash` | low | `modal/fp8` | Mechanical work, summarising |
| `cursor-coder` | `cursor-agent` | `cursor-grok-4.6-high-fast` | high | Cursor-managed | Independent implementation through Cursor Agent |
| `kimi-coder` | `rlm` | `openrouter-morph/moonshotai/kimi-k3` | high | `morph/fp4` | Independent implementation with Kimi K3 |
| `kimi-coder-modal` | `rlm` | `openrouter/moonshotai/kimi-k3` | high | `modal/mxfp4` | Alternate Kimi K3 route through Modal |

`Route` records provider routing that must also be configured in the harness. For
OpenRouter, this repository expects matching `modelOverrides` or routed provider
aliases in `~/.prime/agent/models.json`; `rlm()` does not accept routing fields
per call.
Use a new or reloaded Prime Agent session after changing that file.

For an `rlm` profile, spawn a Prime Agent subagent:

```python
handle = await rlm(prompt, model=profile.model, thinking=profile.thinking, name=job)
```

For a `cursor-agent` profile, launch the configured CLI non-interactively with
`bash()`, persist its stream output in the run's manager-owned `logs/`
directory, and create the internal monitoring heartbeat required by `AGENTS.md`.
The model identifier already encodes Cursor's speed and effort variant. Follow
the non-RLM worker policy; do not pretend the process supports agent messaging
or observation.

### Changing a profile

Ask the manager. For an `rlm` profile it runs
`await rlm.find_models(query)`. For a `cursor-agent` profile it runs
`cursor-agent status` and `cursor-agent models`. It records the exact model ID
shown by that harness rather than translating names between providers.

If a model you want isn't there, it needs credentials:

- **Codex** (`openai/gpt-5.1-codex`) — a ChatGPT Plus or Pro subscription. Run
  `/login` in the TUI and pick ChatGPT.
- **OpenRouter** (`openrouter/<id>`) — `export OPENROUTER_API_KEY=...`, or
  `/login` and pick OpenRouter.
- **Claude** — a Pro/Max subscription via `/login`, or `ANTHROPIC_API_KEY`.
- **Cursor Agent** — run `cursor-agent login`, then verify with
  `cursor-agent status` and `cursor-agent models`.

Login is interactive, so the manager cannot complete it for you. It will tell
you what to run.

---

## Workflows

### investigate

Understand something and produce a plan. No code is changed.

```
investigate (planner)
```

The output is a written plan: what's going on, what to do about it, in what
order, and what could go wrong. This is the input to the `build` workflow later
— write it so another agent can act on it without re-reading the codebase.

Use this whenever the shape of the work isn't obvious. It's cheap relative to a
wrong implementation.

### build

Full cycle for real work that needs thinking first.

```
plan      (planner)
implement (coder)
review    (reviewer)
```

`plan` produces the approach. `implement` does the work and must leave the
project's test command passing. `review` reads the diff and the plan and says
whether they match.

If review fails, loop back to `implement` with the review file as input. After
two failed review attempts, stop and check in with the user before starting any
more implementation or review work.

### build-no-plan

Implement a well-specified change without a planning job, then use the regular
reviewer for an independent quality check.

```
implement (coder)
review    (reviewer)
```

Use this when acceptance criteria are already explicit. `implement` must leave
the authorized verification commands passing. `review` reads `task.md`, the
implementation report, and the workspace diff. If review fails, loop back to
`implement` with the review file as input. After two failed review attempts,
stop and check in with the user before starting any more implementation or
review work.

### Per-run job overrides

Do not create a new workflow only to change a model or harness. Keep the
workflow's job sequence and override the selected job for that run:

```yaml
workflow: build-no-plan
job_overrides:
  implement: kimi-coder
```

The override value is normally a profile name. This keeps the harness, model,
thinking level, and route together. Examples:

```yaml
job_overrides:
  implement: cursor-coder
```

```yaml
job_overrides:
  implement: kimi-coder-modal
  review: quick
```

An explicit mapping may be used when no reusable profile fits:

```yaml
job_overrides:
  implement:
    harness: rlm
    model: openrouter-morph/moonshotai/kimi-k3
    thinking: high
    route: morph/fp4
```

These YAML fragments are request notation only. Never copy a `job_overrides`
object or profile selector into `state.json`. Resolve every job before creating
the run, then store only the actual `harness`, `model`, `thinking`, and `route`
on that job record. Those resolved fields are the historical truth even if a
profile later changes. Retries inherit them unless the user explicitly requests
a different execution choice; each attempt records the values it actually used.

### quickfix

For work where the approach is already obvious.

```
implement (coder)
review    (quick)
```

Skip the plan job. If you find yourself wanting one mid-job, stop and run the
`investigate` workflow instead.

### mockup

Stand something up so the user can see and react to it. Nothing behind it is
real.

```
plan (planner)
mock (coder)
```

`plan` works out what the user needs to *see* — the screens or outputs, the
states worth showing, the happy path being demonstrated. Not architecture.

`mock` builds exactly that, faking everything below the surface:

- Hardcoded data inline. No database, no fixtures, no seed scripts.
- No network calls. Stub every API with a literal response.
- No auth, no persistence, no error handling beyond what's being shown.
- Interactions can be shallow — a button may do nothing if the point is the
  layout.
- Prefer one file over a structure. It's going to be thrown away.

The worker must be told this explicitly, or it will build something real. Say so
in the prompt: *this is a throwaway mockup, fake everything, do not integrate
with existing services.*

No review job. The user is the review.

Keep mockups out of the main branch — a scratch directory or a clearly named
branch. Say where it is when you report back.

### review-only

```
review (reviewer)
```

Read the current diff or a named commit range and report. Changes nothing.

---

## Defaults

- Unspecified standalone job profile: `quick`
- A workflow job uses its listed profile unless that run supplies a job override
- Prefer a profile override; use an explicit resolved mapping only when no profile fits
- State always records the actual resolved execution fields, not only the profile name

## Notes on model choice

Judgement jobs — planning, reviewing — earn a strong model. Mechanical jobs
don't. A cheaper model working against a clear plan and a passing test suite
often beats an expensive one working from a vague brief.

That's the point of profiles: swap `coder` to a cheaper model and every workflow
that uses it changes at once.
