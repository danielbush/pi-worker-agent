# Prime Worker Agent

A directory you run [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
in that turns it into a manager rather than a coder. It talks to you, and
delegates the actual work to worker agents operating on projects that live
elsewhere on disk.

You describe what you want in plain language. The manager picks a workflow,
spawns one worker per job, checks each result before moving on, and reports back
between jobs. Adding a new workflow means editing markdown, not code.

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
  WORKFLOWS.md         # profiles + workflows (you edit this, or ask the manager)
  BACKLOG.md           # ideas not built yet
  projects/
    api/
      README.md        # manager context: path, commands, constraints, goals
      state.json       # the manager writes: header + last 20 runs
      history.jsonl    # the manager appends: older runs, one per line
      runs/            # per-run job output
    website/
      ...
  .agents/skills/      # optional, later: frozen orchestration code
```

One folder per managed project. Everything about a project stays together —
delete the folder and the project is gone.

The split inside it matters:

- `README.md` is manager-owned project context: what the project is, its exact
  checkout or worktree path, approved commands, constraints, and goals. The
  manager extracts a minimal brief for each worker rather than sending this
  whole file.
- `state.json` and `history.jsonl` are the **manager's**. Current status and job
  history. Don't hand-edit — ask the manager to print what you want to see.
- `runs/` is worker output, one directory per run.

JSON rather than markdown for state is deliberate. The manager reads and writes
it in a line of Python and it never drifts. Markdown state gets reformatted a
little more each session until it stops parsing cleanly.

The split by age matters once a project has a hundred runs behind it. `state.json`
stays small enough to hold the recent picture; `history.jsonl` is append-only, so
old runs cost nothing to keep and nothing to write past.

The real cost of state is context, not disk. Loading a large file into a Python
variable is free — only what gets *printed* enters the manager's context. So the
rule in `AGENTS.md` is: load, slice, then display.

## Key constraint

`rlm.run` accepts exactly three kwargs: `name`, `model`, `thinking`. There is no
`cwd`. A worker inherits the manager's working directory — this control
directory, not the target project.

So every worker task prompt must carry the exact absolute execution path and
instruct the worker to `os.chdir` to it before doing anything. That path may be
a Git worktree; the manager must not replace it with the main checkout or Git
common directory. The prompt also carries only the constraints and approved
project commands needed for that job. This is the single most important detail
in the whole setup. Get it wrong and workers quietly edit files in the control
directory.

Workers also do not share the manager's Python kernel. Pass paths between them,
never objects.

## The six steps

### 1. Add a project

Create `projects/<name>/README.md`. Record the exact execution path, whether it
is a directory, checkout, or worktree, what it is, approved project commands,
branch rules, and things not to break.

The manager reads this to resolve "work on the API" into `/Users/you/code/api`.
It keeps the complete context and gives each worker only the path, commands,
constraints, inputs, and output location needed for that job.

Leave `state.json` alone; the manager creates it on first run.

### 2. Write `WORKFLOWS.md`

This is the file you will actually maintain. Two parts.

**Profiles** name a model and thinking level — `planner`, `coder`, `reviewer`,
`quick`. **Workflows** are ordered jobs, each pointing at a profile. So a
workflow says *what kind of agent* does each job, and the profile table says
which model that is. Change the model once, every workflow follows.

Suggested shape, but nothing here is hard-coded — invent your own:

```markdown
## build
plan (planner) -> implement (coder) -> review (reviewer)

## quickfix
implement (coder) -> review (quick)

## mockup
plan (planner) -> mock (coder)
```

Add prose under each where a job name isn't self-explanatory.

Because this is markdown read at runtime, adding a workflow is editing a file.
No code changes, no restart.

### 3. Write `AGENTS.md`

The policy the manager always has in context. In this order:

- You are a manager. You do not write project code yourself.
- Read `WORKFLOWS.md` at the start of a session, and `projects/<name>/README.md`
  plus `state.json` when a project is named.
- Resolve the request to a project and a workflow. Ask if either is ambiguous.
- Run the workflow's jobs in order, one worker per job.
- Every worker prompt must state the exact checkout or worktree path and
  instruct `os.chdir` to it first.
- Give workers minimal job briefs with only relevant constraints and explicitly
  approved project commands; do not hand them the whole manager configuration.
- Check each job's result before starting the next. A failed job loops back
  rather than proceeding.
- Workers write to `projects/<name>/runs/<run-id>/<job>.md`. Read that, don't
  rely on the transcript.
- Update `state.json` when a run starts, changes status, or finishes.
- Report to the user in plain language between jobs.

Keep it short. It's a standing instruction, not a manual.

### 4. Let the manager write the orchestration

Don't pre-write the Python. The manager reads the workflow, then writes the loop
in a cell. Roughly:

```python
handle = await rlm(
    f"os.chdir to {project_path} first. {job_instructions}. "
    f"Allowed project commands: {allowed_commands}. "
    f"Write your result to {run_dir}/{job}.md",
    model=profile.model,
    name=f"{workflow}-{job}",
)
```

Fan out with a list comprehension where jobs are independent. Sequence with a
plain `for` loop where they aren't.

This is the part worth leaving flexible. The manager adapting its own
orchestration to a workflow you invented last week is the whole point.

### 5. Collect results through files

Spawning returns a handle immediately, not an answer. The worker runs detached.

Use `agent_observe` to watch progress, `agent_message.send(...,
receiver_role="child")` to send a follow-up, and `rlm-heartbeat` for long runs.
Keep a child alive until you've read its output.

But treat `runs/<run-id>/<job>.md` as the real interface. Files survive context
compaction and kernel death; handles don't.

### 6. Freeze what stabilises

Once a workflow has run enough times to be boring, ask the manager to turn its
orchestration into a Python skill under `.agents/skills/`. It becomes a callable
function instead of improvised code, and stops being re-derived every session.

Use `/refine` along the way — when a run goes wrong, it updates the notes and
specs from what actually happened.

Do this last. Freezing too early defeats step 4.

## Getting started

Install Prime Agent, then run it in this directory:

```bash
cd prime-worker-agent
prime-agent
```

Say "help me set this up". The manager checks which models you have access to,
walks you through profiles and workflows, and drafts a project README by reading
the project. It'll tell you what to `/login` to if a model you want isn't
configured.

You can also just edit `WORKFLOWS.md` and `projects/<name>/README.md` yourself —
it's all markdown, and the manager reads it at runtime.

Steps 1, 2, and 3 above are what setup is doing on your behalf.

## Sharing

`AGENTS.md`, `WORKFLOWS.md`, and `.agents/skills/` are git-safe and portable.

`projects/` holds local absolute paths and run output. Gitignore it and ship a
`projects/example/README.md` so people can see the shape.

```gitignore
projects/*
!projects/example/
projects/example/runs/*
!projects/example/runs/.gitkeep
```

Don't make the example a nested git repo. The outer repo records it as a gitlink
with no `.gitmodules`, so people cloning get an empty directory.

Note that `harness.create_subagent(...)` state lives in `~/.prime/agent` and does
*not* travel with the repo. Anything you want to share belongs in markdown here.
