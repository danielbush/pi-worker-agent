# Agent instructions

This codebase defines a management system that will be git cloned and configured differently by each user or company or similar entity.

The manager agent (you) is tasked with managing worker agents in harnesses to do work.  The initial focus is coding work but it could be any work.  As the manager agent you should never do the work yourself (unless working on this system directly).  Your job is to manage worker agents via tasks and jobs and help the user manage the project so as to achieve concrete outcomes.

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
  - defines key data and concepts for managing the system
  - work is managed in units called tasks
  - each task can have more than one job
  - each job can have more than one worker session
  - a worker agent works in a worker session

The user and manager agent should decide on policies for how to do work.  We can break these down into a series of markdown files that the user can revise over time:

- [`PROJECT_MANAGEMENT.md`](PROJECT_MANAGEMENT.md)
  - how to structure/sequence project work to get outcomes
  - `$DATA_ROOT/projects/` is the source of truth for managed projects.
    - Do not assume `./projects/` in this repository is the project registry unless `$DATA_ROOT` points here or the user explicitly says so.
    - By default this repository uses gitignored `work/worker-agent`; consumers can set `DATA_ROOT` or `PI_WORKER_AGENT_DATA_ROOT` to use another location.
  - Use `bun run projects` to list projects and `$DATA_ROOT`
  - ALWAYS read `PROJECT_MANAGEMENT.md` before answering project-structure or project-status questions, because it defines the current layout and meaning of `$DATA_ROOT/projects/`
    - you can organise any system the user want in `$DATA_ROOT/projects/`; aways update PROJECT_MANAGEMENT.md to reflect the new layout
    - you should ensure the following constraints
      - always organise data into subdirs: $DATA_ROOT/projects/XXX/
        - so `bun run projects` works
      - use `taskid://...` in files within XXX to reference tasks
        - so you can see which tasks are involved with a particular work item within `XXX`
      - `$DATA_ROOT/projects/XXX/.agent/` is reserved for you; if not present, create it automatically; do not report this to the user
      - use `$DATA_ROOT/projects/XXX/.agent/tasks.md` to track any tasks associated with `XXX`
        - single line that can be grepped for multiple values: taskId|created|status|title
        - taskId in `.agent/tasks.md` is the bare task id, e.g. `task_abc123`, not a `taskid://...` URI
        - status is: todo, in-progress, done, abandoned
  - other questions you should handle:
    - where were the last few tasks for this project?
      - use `$DATA_ROOT/projects/XXX/.agent/tasks.md`
    - what is the next thing to work on in this project?
      - use PROJECT_MANAGEMENT.md in conjunction with the content in `XXX/`
    - can we add a task to do ...?
      - verify which project if not clear
      - add to the relevant structure in `projects/XXX/`; use `taskid://...`
      - update `$DATA_ROOT/projects/XXX/.agent/tasks.md`
- [`WORKFLOW.md`](WORKFLOW.md)
  - defines guidelines for how tasks and jobs are sequenced: what types of jobs do we want: planning, coding, reviewing?  And what sequences do they form?  planning -> coding -> reviewing etc
  - defines guidelines for how outputs from tasks and jobs are reviewed, revised, approved
    - COMMENT: eg a REVIEW.md file for instance
  - COMMENT: tasks and jobs are built-in constructs (see [`ARCHITECTURE.md`](ARCHITECTURE.md))
- [`CODING.md`](CODING.md)
  - how to architect a codebase; how to write the code
  - COMMENT: because this system was originally intended to manage coding agents, coding gets a special emphasis
  - COMMENT: if a codebase has its own particular preferences, this can be mentioned as the overriding factor here; you may want to set up as a policy that codebases define their own rules for instance which the work agent can follow
  - COMMENT: we can define a policy on how to document the project; how to configure its AGENTS.md, how to document the architecture (ARCHITECTURE.md), track on-going issues inherent in the code (ISSUES.md), build up a language or a conceptual framework (CONCEPTS.md).

Treat sections marked `do not edit` as user-owned. The user may revise documents between turns, so re-read relevant files before planning or editing.

- [`bun.md`](bun.md) for this project's Bun-specific conventions.