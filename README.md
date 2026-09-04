# Prime Worker Agent

A directory you run [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
in that turns it into a manager rather than a coder. It talks to you, and
delegates the actual work to worker agents operating on projects that live
elsewhere on disk.

You describe what you want in plain language. The manager picks a workflow,
spawns one worker per stage, checks each result before moving on, and reports
back between stages. Adding a new kind of job means editing markdown, not code.

## Why a separate directory

Prime Agent loads `AGENTS.md` from the working directory into the system prompt
automatically, and loads skills from `.agents/skills/` there too. So a directory
*is* a configuration unit. Run the agent here and it comes up as a manager. Run
it inside a project and it comes up as an ordinary coding agent.

Nothing here is a codebase. It is policy, workflow definitions, and per-project
tracking.

## Layout

```
prime-worker-agent/
  AGENTS.md            # policy — auto-loaded into the manager's system prompt
  WORKFLOWS.md         # job types: stages and preferred models (you edit this)
  projects/
    api/
      README.md        # you write: what this is, its path, constraints, goals
      state.json       # the manager writes: jobs, status, history
      runs/            # per-run stage output
    website/
      ...
  .agents/skills/      # optional, later: frozen orchestration code
```

One folder per managed project. Everything about a project stays together —
delete the folder and the project is gone.

The split inside it matters:

- `README.md` is **yours**. The brief. What the project is, where it lives, how
  to test it, what you care about.
- `state.json` is the **manager's**. Job history, current status, anything it
  needs to pick up where it left off. Don't hand-edit it — ask the manager to
  print it instead.
- `runs/` is worker output, one directory per run.

JSON rather than markdown for `state.json` is deliberate. The manager reads and
writes it in a line of Python and it never drifts. Markdown state gets
reformatted a little more each session until it stops parsing cleanly.

## Key constraint

`rlm.run` accepts exactly three kwargs: `name`, `model`, `thinking`. There is no
`cwd`. A worker inherits the manager's working directory — this control
directory, not the target project.

So every worker task prompt must carry the absolute project path and instruct
the worker to `os.chdir` to it before doing anything. This is the single most
important detail in the whole setup. Get it wrong and workers quietly edit files
in the control directory.

Workers also do not share the manager's Python kernel. Pass paths between them,
never objects.

## The six steps

### 1. Add a project

Create `projects/<name>/README.md`. Absolute path, one line on what it is, and
anything a worker needs before touching it — test command, package manager,
branch rules, things not to break.

The manager reads this to resolve "work on the API" into `/Users/you/code/api`,
and to brief the workers it spawns.

Leave `state.json` alone; the manager creates it on first run.

### 2. Write `WORKFLOWS.md`

This is the file you will actually maintain. It defines job types. Each is a
name, an ordered list of stages, and a preferred model per stage.

Suggested shape, but nothing here is hard-coded — invent your own:

```markdown
## implement
plan (opus) -> implement (sonnet) -> review (opus)

## quickfix
implement (sonnet) -> review (sonnet)

## investigate
investigate (opus)
```

Add prose under each where a stage name isn't self-explanatory. Add a default
model line for anything unspecified.

Because this is markdown read at runtime, adding a job type is editing a file.
No code changes, no restart.

### 3. Write `AGENTS.md`

The policy the manager always has in context. In this order:

- You are a manager. You do not write project code yourself.
- Read `WORKFLOWS.md` at the start of a session, and `projects/<name>/README.md`
  plus `state.json` when a project is named.
- Resolve the request to a project and a job type. Ask if either is ambiguous.
- Run the job type's stages in order, one worker per stage.
- Every worker prompt must state the absolute project path and instruct
  `os.chdir` to it first.
- Check each stage's result before starting the next. A failed stage loops back
  rather than proceeding.
- Workers write to `projects/<name>/runs/<run-id>/<stage>.md`. Read that, don't
  rely on the transcript.
- Update `state.json` when a job starts, changes status, or finishes.
- Report to the user in plain language between stages.

Keep it short. It's a standing instruction, not a manual.

### 4. Let the manager write the orchestration

Don't pre-write the Python. The manager reads the workflow, then writes the loop
in a cell. Roughly:

```python
handle = await rlm(
    f"os.chdir to {project_path} first. {stage_instructions}. "
    f"Write your result to {run_dir}/{stage}.md",
    model=stage_model,
    name=f"{job}-{stage}",
)
```

Fan out with a list comprehension where stages are independent. Sequence with a
plain `for` loop where they aren't.

This is the part worth leaving flexible. The manager adapting its own
orchestration to a job type you invented last week is the whole point.

### 5. Collect results through files

Spawning returns a handle immediately, not an answer. The worker runs detached.

Use `agent_observe` to watch progress, `agent_message.send(...,
receiver_role="child")` to send a follow-up, and `rlm-heartbeat` for long runs.
Keep a child alive until you've read its output.

But treat `runs/<run-id>/<stage>.md` as the real interface. Files survive context
compaction and kernel death; handles don't.

### 6. Freeze what stabilises

Once a workflow has run enough times to be boring, ask the manager to turn its
orchestration into a Python skill under `.agents/skills/`. It becomes a callable
function instead of improvised code, and stops being re-derived every session.

Use `/refine` along the way — when a run goes wrong, it updates the notes and
specs from what actually happened.

Do this last. Freezing too early defeats step 4.

## Start here

Steps 1, 2, and 3 alone give you a working manager. Everything after is
refinement.

## Sharing

`AGENTS.md`, `WORKFLOWS.md`, and `.agents/skills/` are git-safe and portable.

`projects/` holds local absolute paths and run output. Gitignore it and ship a
`projects/example/README.md` so people can see the shape.

```gitignore
projects/*
!projects/example/
```

Note that `harness.create_subagent(...)` state lives in `~/.prime/agent` and does
*not* travel with the repo. Anything you want to share belongs in markdown here.
