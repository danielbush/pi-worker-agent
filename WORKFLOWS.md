# Workflows

Two things live here: **profiles** (which model does what kind of work) and
**job types** (which stages run in what order).

Edit this file to add, remove, or reshape either. No code changes needed. Ask
the manager to help — it can check which models you actually have access to.

## Profiles

A profile is a named model plus thinking level. Stages reference profiles, not
models, so you change your mind in one place.

| Profile | Model | Thinking | For |
|---|---|---|---|
| `planner` | `anthropic/claude-opus-5` | high | Working out approach, weighing options |
| `coder` | `anthropic/claude-sonnet-5` | medium | Writing the change |
| `reviewer` | `anthropic/claude-opus-5` | high | Judging whether it's right |
| `quick` | `anthropic/claude-sonnet-5` | off | Mechanical work, summarising |

Every stage runs as a Prime Agent subagent:

```python
handle = await rlm(prompt, model=profile.model, thinking=profile.thinking, name=stage)
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

## Job types

### investigate

Understand something and produce a plan. No code is changed.

```
investigate (planner)
```

The output is a written plan: what's going on, what to do about it, in what
order, and what could go wrong. This is the input to `implement` later — write
it so another agent can act on it without re-reading the codebase.

Use this whenever the shape of the work isn't obvious. It's cheap relative to a
wrong implementation.

### implement

Full cycle for work that needs thinking first.

```
plan      (planner)
implement (coder)
review    (reviewer)
```

`plan` produces the approach. `implement` does the work and must leave the
project's test command passing. `review` reads the diff and the plan and says
whether they match.

If review fails, loop back to `implement` with the review file as input. Two
loops maximum, then report to the user.

### quickfix

For work where the approach is already obvious.

```
implement (coder)
review    (quick)
```

Skip the plan stage. If you find yourself wanting one mid-stage, stop and run
`investigate` instead.

### review-only

```
review (reviewer)
```

Read the current diff or a named commit range and report. Changes nothing.

---

## Defaults

- Unspecified profile: `quick`
- A stage may override with an explicit model where a profile doesn't fit

## Notes on model choice

Judgement stages — planning, reviewing — earn a strong model. Mechanical stages
don't. A cheaper model working against a clear plan and a passing test suite
often beats an expensive one working from a vague brief.

That's the point of profiles: swap `coder` to a cheaper model and every job type
that uses it changes at once.
