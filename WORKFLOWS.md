# Workflows

Job types the manager can run. Each is a name, an ordered list of stages, and a
model per stage.

Edit this file to add, remove, or reshape a job. No code changes needed.

## Stages

Every stage runs as a Prime Agent subagent:

```python
handle = await rlm(prompt, model="anthropic/claude-opus-5", name="plan")
```

Only `name`, `model`, and `thinking` are accepted. Results arrive by file.

---

## Job types

### investigate

Understand something and produce a plan. No code is changed.

```
investigate (opus, thinking=high)
```

The output is a written plan: what's going on, what to do about it, in what
order, and what could go wrong. This is the input to `implement` later — write
it so another agent can act on it without re-reading the codebase.

Use this whenever the shape of the work isn't obvious. It's cheap relative to a
wrong implementation.

### implement

Full cycle for work that needs thinking first.

```
plan      (opus,   thinking=high)
implement (sonnet)
review    (opus,   thinking=high)
```

`plan` produces the approach. `implement` does the work and must leave the
project's test command passing. `review` reads the diff and the plan and says
whether they match.

If review fails, loop back to `implement` with the review file as input. Two
loops maximum, then report to the user.

### quickfix

For work where the approach is already obvious.

```
implement (sonnet)
review    (sonnet)
```

Skip the plan stage. If you find yourself wanting one mid-stage, stop and run
`investigate` instead.

### review-only

```
review (opus, thinking=high)
```

Read the current diff or a named commit range and report. Changes nothing.

---

## Defaults

- Unspecified model: `anthropic/claude-sonnet-5`
- Unspecified thinking: inherited from the manager

## Notes on model choice

Judgement stages — planning, reviewing — earn a strong model. Mechanical stages
don't. A cheaper model working against a clear plan and a passing test suite
often beats an expensive one working from a vague brief.

Every stage names its own model, so mix freely.
