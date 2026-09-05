# Workflows

Two things live here: **profiles** (which model does what kind of work) and
**workflows** (which jobs run in what order).

Edit this file to add, remove, or reshape either. No code changes needed. Ask
the manager to help — it can check which models you actually have access to.

## Profiles

A profile is a named model plus thinking level. Jobs reference profiles, not
models, so you change your mind in one place.

| Profile | Model | Thinking | For |
|---|---|---|---|
| `planner` | `openai-codex/gpt-5.6-sol` | medium | Working out approach, weighing options |
| `coder` | `openrouter/z-ai/glm-5.3-flash` | high | Writing the change |
| `reviewer` | `openai-codex/gpt-5.6-sol` | medium | Judging whether it's right |
| `quick` | `openrouter/z-ai/glm-5.3-flash` | low | Mechanical work, summarising |

Every job runs as a Prime Agent subagent:

```python
handle = await rlm(prompt, model=profile.model, thinking=profile.thinking, name=job)
```

Only `name`, `model`, and `thinking` are accepted.

### Changing a profile

Ask the manager. It runs `await rlm.find_models(query)` to see what's actually
configured, and edits the table.

If a model you want isn't there, it needs credentials:

- **Codex** (`openai/gpt-5.1-codex`) — a ChatGPT Plus or Pro subscription. Run
  `/login` in the TUI and pick ChatGPT.
- **OpenRouter** (`openrouter/<id>`) — `export OPENROUTER_API_KEY=...`, or
  `/login` and pick OpenRouter.
- **Claude** — a Pro/Max subscription via `/login`, or `ANTHROPIC_API_KEY`.

`/login` is interactive, so the manager can't do it for you. It will tell you
what to run.

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

- Unspecified profile: `quick`
- A job may override with an explicit model where a profile doesn't fit

## Notes on model choice

Judgement jobs — planning, reviewing — earn a strong model. Mechanical jobs
don't. A cheaper model working against a clear plan and a passing test suite
often beats an expensive one working from a vague brief.

That's the point of profiles: swap `coder` to a cheaper model and every workflow
that uses it changes at once.
