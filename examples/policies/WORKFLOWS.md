# Workflows

Three things live here: **profiles** (which model does what kind of work),
**job types** (what each job in a workflow is), and **workflows** (which jobs
run in what order, and whether the run needs your approval first).

Edit this file to add, remove, or reshape either. No code changes needed. Ask
the manager to help — it can check which models you actually have access to.

## Profiles

A concrete profile is named `role/model[/route]` and bundles its harness,
model, thinking level, and provider route. Preferred roles select which concrete
profile workflows use by default.

| Profile | Harness | Model | Thinking | Route | For |
|---|---|---|---|---|---|
| `planner/sol` | `rlm` | `openai-codex/gpt-5.6-sol` | medium | — | Default planning and approach design |
| `planner/sol-high` | `rlm` | `openai-codex/gpt-5.6-sol` | high | — | Opt-in planning for unusually complex work |
| `review/sol` | `rlm` | `openai-codex/gpt-5.6-sol` | medium | — | Independent review |
| `coder/grok` | `cursor-agent` | `cursor-grok-4.6-medium-fast` | medium | Cursor-managed | Coding through Cursor Agent |
| `coder/glm` | `rlm` | `openrouter-routed/z-ai/glm-5.3-flash` | high | — | Coding with GLM; medium is unsupported |
| `coder/kimi` | `rlm` | `openrouter-routed/moonshotai/kimi-k3` | medium | — | Coding with Kimi |
| `quick/glm` | `rlm` | `openrouter-routed/z-ai/glm-5.3-flash` | low | — | Mechanical work and summarising |
| `coder/codex-medium` | `codex` | `gpt-5.6-sol` | medium | — | Coding through Codex CLI |
| `coder/codex-high` | `codex` | `gpt-5.6-sol` | high | — | Harder coding through Codex CLI |
| `coder/claude-opus-5` | `claude-code` | `opus` | medium | — | Coding through Claude Code using the current Opus 5 selector |

## Preferred profiles

| Workflow role | Preferred profile | Used for |
|---|---|---|
| `planning` | `planner/sol` | Drafting the `00-task.md` spec before a run is approved |
| `coding` | `coder/grok` | Implementation and mock jobs |
| `reviewing` | `review/sol` | Independent review jobs |

Preferences are defaults, not aliases stored in run state. The manager resolves
the role to the preferred concrete profile before creating a run, then records
only the actual execution fields on each job.

`Route` records provider routing that must also be configured in the harness. For
OpenRouter, this repository expects matching `modelOverrides` or routed provider
aliases in `~/.prime/agent/models.json`; `rlm()` does not accept routing fields
per call.
Use a new or reloaded Prime Agent session after changing that file.

For an `rlm` profile, spawn a Prime Agent subagent:

```python
handle = await rlm(prompt, model=profile.model, thinking=profile.thinking, name=job)
```

For a `cursor-agent`, `codex`, or `claude-code` profile, launch the configured
CLI non-interactively with `bash()`, persist its stream output in the run's
manager-owned `logs/` directory, and create the internal monitoring heartbeat
required by `AGENTS.md`. For Claude Code, the profile may use a documented
model selector such as `opus`; capture the concrete model from the stream init
event and record what actually ran. Read and follow
`.agents/skills/run-external-worker/SKILL.md` before launch; do not pretend the
process supports agent messaging or observation.

### Changing a profile

Ask the manager. For an `rlm` profile it runs
`await rlm.find_models(query)`. For a `cursor-agent` profile it runs
`cursor-agent status` and `cursor-agent models`. It records the exact model ID
shown by that harness rather than translating names between providers.

If a model you want isn't there, it needs credentials:

- **Codex** (`openai/gpt-5.1-codex`) — a ChatGPT Plus or Pro subscription. Run
  `/login` in the TUI and pick ChatGPT.
- **OpenRouter** (`openrouter-routed/<id>`) — `export OPENROUTER_API_KEY=...`, or
  `/login` and pick OpenRouter.
- **Claude** — a Pro/Max subscription via `/login`, or `ANTHROPIC_API_KEY`.
- **Cursor Agent** — run `cursor-agent login`, then verify with
  `cursor-agent status` and `cursor-agent models`.

Login is interactive, so the manager cannot complete it for you. It will tell
you what to run.

---

## Per-run execution choices

Do not create a new workflow only to change a model or harness. Keep the
workflow's job sequence and override the selected job for that run:

```yaml
workflow: build-no-plan
job_overrides:
  implement: coder/kimi
```

The override value is normally a profile name. This keeps the harness, model,
thinking level, and route together. Examples:

```yaml
job_overrides:
  implement: coder/grok
```

```yaml
job_overrides:
  implement: coder/kimi
  review: quick/glm
```

An explicit mapping may be used when no reusable profile fits:

```yaml
job_overrides:
  implement:
    harness: rlm
    model: openrouter-routed/moonshotai/kimi-k3
    thinking: medium
    route: morph/fp4
```

These YAML fragments are request notation only. Never copy a `job_overrides`
object or profile selector into `state.json`. Resolve every job before creating
the run, then store only the actual `harness`, `model`, `thinking`, and `route`
on that job record. Those resolved fields are the historical truth even if a
profile later changes. Retries inherit them unless the user explicitly requests
a different execution choice; each attempt records the values it actually used.

---

## Job types

Each job in a workflow is one of these types. A job type fixes the job's
purpose, inputs, and outputs; its workflow role selects the preferred profile
via the Preferred profiles table. Workers receive their concrete
brief from the manager — this table is the shared vocabulary, not a prompt.

| Job type | Role | Purpose | Inputs | Output |
|---|---|---|---|---|
| `investigate` | planning | Understand code or behaviour; change nothing | The question; read-only workspace | Written findings in its report |
| `draft` | planning | Produce the task spec that becomes `00-task.md`: append a concrete `## Demo` (what the user will run and see) and a `## Plan` (step-by-step what will happen, in order), plus a few hard constraints and allowed commands. Keep it SHORT; no acceptance criteria — the Demo is the contract. Criteria come from the user only; never invent them; ask for clarity when the request is vague. | The original request; project README/context; optional `investigate` report | Drafted `00-task.md` content in its report |
| `implement` | coding | Make the change in the workspace | `00-task.md` (the approved plan); prior reports | Code + verification; report |
| `mock` | coding | Build a throwaway fake for user reaction | `00-task.md`; prior reports | Scratch code, never integrated; report |
| `review` | reviewing | Independent verdict on work done — judge against the coding-standards stack, applying their priority (`00-task.md` constraints, then project `CODE.md`, then global `policies/CODE.md`) | `00-task.md`, reports, workspace diff, standards files | PASS/FAIL verdict in its report |

Rules that apply to every job type:

- `implement` must leave the authorized verification commands passing.
- `review` changes nothing; it reports PASS or FAIL with reasons. Where the
  run has a Demo section, the review verifies the demo: follow its steps and
  check the outputs match. A broken demo is a FAIL.
- When `review` fails, loop back to `implement` with the review report as
  input. After two failed review attempts, stop and check in with the user
  before any more implementation or review work.

## Revisions

Feedback on a run's work — from a failed `review`, or from the user reviewing
personally — stays **inside the same run** as a new numbered `implement`
attempt. The attempt gets the prior reports plus the feedback as its input,
writes the next report number, and the run returns to `running`.

Open a **new run** only when the objective or scope changes, not the quality
of the attempt. "The tests should use pytest now that policy changed" is a new
run; "break these classes out into lib/" is a revision of the run that made
the classes. When in doubt, ask the user which they intend.

---

## Grounding rule

Significant implementation work must produce a **working vertical slice**:
something the user can run and see, as early as possible. Prefer a thin
end-to-end skeleton that does something real over a broad layer of
half-built machinery. If a task's Demo cannot be written concretely, the task
is not ready — narrow it until it can. Large asks should be split into runs
whose demos each stand alone.

## Approval

Every run requires your approval of its `00-task.md` before the first worker
spawns. The Demo section is the first thing to check: if what-you-will-see
is wrong or vague, the spec is wrong. The manager creates the run, writes `00-task.md`, records the run as
`awaiting-approval`, and offers to open the spec in your editor so you can
review and adjust it directly. On approval it records an `approved` timestamp
on the run, marks it `running`, and starts work — re-reading `00-task.md` first
if you edited it.

- Approval is per run, not per job: retries and review loops inside an
  approved run do not re-ask.
- A new run — including a re-attempt of a failed run — needs its own approval.
- You may waive approval when requesting work ("just run it"); the manager
  records the waiver in `00-task.md`.

---

## Project READMEs

Every managed project's README leads with a **Demo** section, followed by an
**Outcomes** list. Demo is first because it's what the user reads to recall
what the project is about when many runs are in flight.

The Demo says what the user should **see, touch, or handle** — it must be
real: concrete commands to run, screens to open, things to click. It may
change, because details of what hasn't been built yet are hard to tie down,
but it always needs grounding in specific detail, not aspirations.

Outcomes is a simple list of items that lets the manager and the user decide
whether a piece of work is finished. Items take obvious cues from the Demo —
each outcome should be checkable against something the Demo shows.

Both are written with the user and must exist before the project's first run
— the manager asks for them explicitly and does not create runs until they
are recorded. User feedback that changes the Demo or an outcome is recorded
by editing the README, not just the run.

## Workflows

All workflows below run with `approval: required`.

### manual (default)

Run exactly one job type chosen by the user, then stop and ask what to do next.

```
jobs: [user-selected]
```

The available choices are `investigate`, `draft`, `implement`, `mock`, and
`review`. If the user has not named the next job type, ask them to choose one;
do not infer it from the request. Each choice adds only that one job to the
current task.

After the selected job finishes, set the task to `awaiting-user-review` and ask
the user to choose the next job type or finish the task. Do not automatically
draft, implement, review, fix, retry, or start any other follow-up job. In this
workflow, the review-fail loop does not apply: a failed review also stops for
the user's decision.

Selecting another job is explicit authorization for that job, but it does not
waive any required approval of a new or changed brief. Keep later jobs and
revisions in the same task unless the objective or scope materially changes.

Use `manual` whenever the user does not explicitly name another workflow.
Do not interpret a broad request as permission to substitute `build`,
`build-no-plan`, `quickfix`, or any other multi-job workflow.

### investigate

Understand something and write up findings/approach. No code is changed.

```
jobs: [investigate]
```

The output is a written plan: what's going on, what to do about it, in what
order, and what could go wrong. Use it to understand a codebase before a spec
is drafted, or as findings a `draft` job can turn into a `00-task.md`. Write it
so it survives without re-reading the codebase.

Use this whenever the shape of the work isn't obvious. It's cheap relative to a
wrong implementation.

### build

Full cycle for real work. The plan lives in the approved `00-task.md` (drafted
before the run starts, per Handling a request), so the run itself needs no
planning job.

```
jobs: [implement, review]
```

`implement` does the work against the approved spec; `review` reads the diff
and the spec and says whether they match (review-fail loop applies — see
Job types).

### build-no-plan

Implement a well-specified change, then use the regular reviewer for an
independent quality check. Same job sequence as `build`; kept as an alias for
runs whose spec was already explicit without a draft round.

```
jobs: [implement, review]
```

Use this when acceptance criteria are already explicit.

### quickfix

For work where the approach is already obvious.

```
jobs: [implement, review]
```

The spec is already clear, so no `draft` round is needed. If you find yourself
wanting to understand the code first, stop and run the `investigate` workflow.

### mockup

Stand something up so the user can see and react to it. Nothing behind it is
real.

```
jobs: [mock]
```

The spec drafted into `00-task.md` before the run works out what the user needs
to *see* — the screens or outputs, the states worth showing, the happy path
being demonstrated. `mock` then builds exactly that, faking everything below
the surface:

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
jobs: [review]
```

Read the current diff or a named commit range and report. Changes nothing.

---

## Defaults

- Default workflow: `manual`; the user selects one job at a time
- Workflow roles resolve through the Preferred profiles table
- All runs require `00-task.md` approval before work starts, unless the user
  waives it for that run
- Unspecified standalone mechanical job profile: `quick/glm`
- A run may select another concrete profile for one job
- Prefer a concrete profile choice; use an explicit resolved mapping only when none fits
- State records only actual resolved execution fields, never roles or profile names

## Notes on model choice

Judgement jobs — planning, reviewing — earn a strong model. Mechanical jobs
don't. A cheaper model working against a clear plan and a passing test suite
often beats an expensive one working from a vague brief.

That's the point of preferred roles: change the `coding` preference once and
every workflow using that role follows, while historical run state keeps the
actual model that ran.
