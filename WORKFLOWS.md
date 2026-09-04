# Workflows

Job types the manager can run. Each is a name, an ordered list of stages, and
per-stage model and runner.

Edit this file to add, remove, or reshape a job. No code changes needed.

## Runners

A runner is *what executes a stage*. Three are defined here.

### `rlm` — in-process Prime Agent subagent

The default. Cheapest to start, shares nothing but the filesystem.

```python
handle = await rlm(prompt, model="anthropic/claude-opus-5", name="plan")
```

Only `name`, `model`, and `thinking` are accepted. Results arrive by file.

### `prime` — a separate Prime Agent process

Use when the stage should run to completion unattended, with a hard gate.

```python
result = await bash(
    f'cd {shlex.quote(project_path)} && prime-agent -p --autonomous '
    f'--autonomous-gate "pnpm check" --autonomous-gate-retries 2 '
    f'--autonomous-max-turns 12 --thinking high '
    f'--model {model} '
    f'{shlex.quote(prompt)}'
)
```

`bash()` takes a command string only — there is no `cwd` argument, and it
inherits the manager's working directory. Put the `cd` in the command. Quote the
prompt with `shlex.quote`; stage instructions contain quotes and newlines.

`--autonomous-gate` is the useful part: the stage isn't done until the command
passes. Good for implement stages.

Models take a `provider/id` form. OpenRouter is a supported provider, so
`--model openrouter/<id>` works once `OPENROUTER_API_KEY` is set. Codex is
`--model openai/gpt-5.1-codex`.

### `cursor` — cursor-agent CLI

Different harness, different strengths. **Verify the flags before relying on
this** — they are not checked here.

```python
result = await bash(
    f'cd {shlex.quote(project_path)} && cursor-agent -p {shlex.quote(prompt)}'
)
```

### Adding a runner

Add a section here with the exact invocation. The manager reads this file, so a
new runner is available immediately.

---

## Job types

### investigate

Understand something and produce a plan. No code is changed.

```
investigate (rlm, opus, thinking=high)
```

The output is a written plan: what's going on, what to do about it, in what
order, and what could go wrong. This is the input to `implement` later — write
it so another agent can act on it without re-reading the codebase.

Use this whenever the shape of the work isn't obvious. It's cheap relative to a
wrong implementation.

### implement

Full cycle for work that needs thinking first.

```
plan     (rlm,   opus,   thinking=high)
implement(prime, codex,  gate="<project test command>")
review   (rlm,   opus,   thinking=high)
```

`plan` produces the approach. `implement` runs unattended behind the project's
test gate. `review` reads the diff and the plan and says whether they match.

If review fails, loop back to `implement` with the review file as input. Two
loops maximum, then report to the user.

### quickfix

For work where the approach is already obvious.

```
implement (prime, codex, gate="<project test command>")
review    (rlm,  sonnet)
```

Skip the plan stage. If you find yourself wanting one mid-stage, stop and run
`investigate` instead.

### review-only

```
review (rlm, opus, thinking=high)
```

Read the current diff or a named commit range and report. Changes nothing.

---

## Defaults

- Unspecified model: `anthropic/claude-sonnet-5`
- Unspecified runner: `rlm`
- Unspecified thinking: inherited from the manager

## Notes on model choice

Judgement stages — planning, reviewing — earn a strong model. Mechanical stages
don't. The gate does the quality work in an `implement` stage, so a cheaper
model behind a strict gate often beats an expensive one without.

Every stage names its own model, so mix freely.
