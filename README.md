# Prime Worker Agent — Plan

A control-plane directory for Prime Agent. You run one manager agent here. It
talks to you, and it delegates the actual work to worker agents that operate on
projects living elsewhere on disk.

Nothing in this directory is a codebase. It is policy, workflow definitions, and
a project registry — all plain markdown, all shareable via git.

## Why a separate directory

Prime Agent loads `AGENTS.md` from the working directory into the system prompt
automatically, and loads skills from `.agents/skills/` in the working directory.
So a directory *is* a configuration unit. Run the agent here and it comes up as a
manager. Run it inside a project and it comes up as an ordinary coding agent.

The projects stay where they are. This directory only holds their paths.

## Layout

```
prime-worker-agent/
  AGENTS.md          # policy — auto-loaded into the manager's system prompt
  WORKFLOWS.md       # job types: stages and preferred models (you edit this)
  PROJECTS.md        # registry: name -> absolute path -> notes
  runs/              # per-run notes and worker output, gitignored
  .agents/skills/    # optional, later: frozen orchestration code
```

## Key constraint

`rlm.run` accepts exactly three kwargs: `name`, `model`, `thinking`. There is no
`cwd`. A worker inherits the manager's working directory — this control
directory, not the target project.

So every worker task prompt must carry the absolute project path, and instruct
the worker to `os.chdir` to it before doing anything. This is the single most
important detail in the whole setup. Get it wrong and workers quietly edit files
in the control directory.

Workers also do not share the manager's Python kernel. Pass paths between them,
never objects.

## The six steps

### 1. Write `PROJECTS.md`

A table. Name, absolute path, one line on what it is, and anything a worker
needs to know before touching it (test command, package manager, branch rules).

The manager reads this to resolve "work on the API project" into
`/Users/danb/projects/api`.

### 2. Write `WORKFLOWS.md`

This is the file you will actually maintain. It defines job types. Each one is a
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

Add prose under each where the stage names are not self-explanatory. Add a
default model line for anything unspecified.

Because this is markdown read at runtime, adding a job type is editing a file.
No code changes, no restart.

### 3. Write `AGENTS.md`

The policy the manager always has in context. It should say, in this order:

- You are a manager. You do not write project code yourself.
- Always read `WORKFLOWS.md` and `PROJECTS.md` at the start of a session.
- Resolve the user's request to a project path and a job type. Ask if either is
  ambiguous.
- Run the job type's stages in order, one worker per stage.
- Every worker prompt must state the absolute project path and instruct
  `os.chdir` to it first.
- Check each stage's result before starting the next. A failed stage loops back
  rather than proceeding.
- Workers write output to `runs/<run-id>/<stage>.md`. Read that, do not rely on
  the transcript.
- Report back to the user in plain language between stages.

Keep it short. It is a standing instruction, not a manual.

### 4. Let the manager write the orchestration

Do not pre-write the Python. The manager reads the workflow, then writes the
loop in a cell. Roughly:

```python
import os
handle = await rlm(
    f"cd to {project_path} with os.chdir first. {stage_instructions}. "
    f"Write your result to {run_dir}/{stage}.md",
    model=stage_model,
    name=f"{job}-{stage}",
)
```

Fan out with a list comprehension where stages are independent. Sequence with a
plain `for` loop where they are not.

This is the part worth leaving flexible. The manager adapting its own
orchestration to a novel job type is the whole point of the setup.

### 5. Collect results through files

Spawning returns a handle immediately, not an answer. The worker runs detached.

Use `agent_observe` to watch progress, `agent_message.send(...,
receiver_role="child")` to send a follow-up, and `rlm-heartbeat` for long runs.
Keep a child alive until you have read its output.

But treat `runs/<run-id>/<stage>.md` as the real interface. Files survive
context compaction and kernel death; handles do not.

### 6. Freeze what stabilises

Once a workflow has run enough times to be boring, ask the manager to turn its
orchestration into a Python skill under `.agents/skills/`. It becomes a callable
function instead of improvised code, and the manager stops re-deriving it.

Use `/refine` along the way. When a run goes wrong, it updates the specs and
notes from what actually happened.

Do this last. Freezing too early defeats the flexibility in step 4.

## Start here

Steps 1, 2, and 3 alone give you a working manager. Everything after that is
refinement.

## Sharing

`AGENTS.md`, `WORKFLOWS.md`, and `.agents/skills/` are all git-safe and portable.

`PROJECTS.md` holds local absolute paths — either gitignore it and ship a
`PROJECTS.example.md`, or keep the table and let people replace the paths.

`runs/` should be gitignored.

Note that `harness.create_subagent(...)` state lives in `~/.prime/agent` and does
*not* travel with the repo. Keep anything you want to share in markdown here
instead.
