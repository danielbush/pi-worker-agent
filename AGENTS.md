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

## Manager communication

- Before summarizing a managed project, read its active `PROJECT.md` for directives on the summary's content and format, and follow them.
- If that policy contains no summary directives, give a concise overview and offer detail on request.

## Manager startup

Before any managed-project work:

1. Call `worker_verify_project_structure`. It verifies that `$DATA_ROOT/projects/` contains only immediate project subdirectories, every project has `sequence.md`, and every directory corresponds to registered project metadata. If it fails, stop and report all structural problems; do not probe or improvise.
2. Call `worker_list_projects`. If it fails, stop and report the error; do not probe or improvise.
3. Read the reported `PROJECT.md` and follow it to interpret the project files. Do not assume their layout.
4. For project status, call `worker_project_tasks` and combine its relational facts with the policy-defined project files.
5. Before task or job work, read `WORKFLOW.md`; for coding, also read `CODE.md` and the codebase instructions.

The structure-verification tool is one of the manager's standard ways to know that the bridge between structured project identity and the unstructured, policy-owned project area is in order. It checks only application invariants; files inside each project remain soft policy interpreted through `PROJECT.md`. Project/task/job storage and directory-to-project-ID mappings are hard application invariants.

Use `worker_manage_project_file` to create, update, or delete policy-owned text files under a registered project without enabling development mode. Always read `PROJECT.md` and the current target before editing. Pass exact inspected content for updates and deletes so concurrent changes fail closed; preserve user comments; report the returned diff. The tool's hard boundary is registered-project containment, not the meaning or format of policy files.

Do not infer a named workflow from slash commands or implementation code. Names such as **Demo task** refer to sections in `$DATA_ROOT/WORKFLOW.md`; they are manager policy, not commands. Apply the selected workflow one transition at a time, evaluating each completed job before creating the next one. Re-read these files on later turns because the user may revise them.

Agent profiles and job types are binding database configuration, not Markdown configuration. Before creating task work, use the execution-catalog list tools to confirm active profiles and job types. Use the narrow management tools to create, describe, retire, or reactivate them; every job type requires a trusted capability, worktree strategy, and active default profile. Agent execution fields are immutable after creation, so create a replacement profile and retire the old one rather than editing a model, harness, or options in place. Task overrides select an active profile for one configured job type and cannot change capability or worktree placement.

When an implementation is ready under the workflow, tell the user the job has finished and ask whether they want to merge it into the project. If they ask to look first, use the completed-job inspection tool, open the derived worktree with the configured editor tool, and call line-by-line changes a diff or `git diff`; inspection does not authorize merging. Call the completed-job merge tool only after the user approves in conversation. Do not ask for a redundant second confirmation; the tool derives both worktree and destination from the completed implementation job.

- **`$DATA_ROOT/PROJECT.md`**
  - active project-management policy; consumers normally copy `examples/PROJECT.md` here or create their own policy; this checkout symlinks the file only as a maintainer convenience for editing and using the example in place
  - how to structure/sequence project work to get outcomes
  - `$DATA_ROOT/projects/` is the source of truth for managed projects.
    - Every immediate entry must be a project subdirectory with `sequence.md`, and each subdirectory must map to a synthetic row in SQLite `projects`; use `worker_verify_project_structure` to audit this boundary and manager project tools to register, query, or associate tasks.
    - SQLite `projects_tasks` is the relational source of project task membership and status queries; `taskid://...` references remain human-facing links.
    - Do not assume `./projects/` in this repository is the project registry unless `$DATA_ROOT` points here or the user explicitly says so.
    - By default this repository uses the gitignored `work/` directory; consumers can set `DATA_ROOT` or `PI_WORKER_AGENT_DATA_ROOT` to use another location.
  - Use `bun run projects` to list projects and `$DATA_ROOT`
  - ALWAYS read `$DATA_ROOT/PROJECT.md` before answering project-structure or project-status questions, because it defines the current layout and meaning of `$DATA_ROOT/projects/`
    - if `$DATA_ROOT/PROJECT.md` is missing, stop and report it; suggest copying `examples/PROJECT.md` into the data root rather than silently applying policy from another path
    - you can organise any system the user want in `$DATA_ROOT/projects/`; aways update `$DATA_ROOT/PROJECT.md` to reflect the new layout
    - you should ensure the following constraints
      - always organise data into subdirs: $DATA_ROOT/projects/XXX/
        - so `bun run projects` works
        - use `worker_manage_project_file` rather than unrestricted filesystem tools when manager-mode work changes policy-owned project text
      - use `taskid://...` in files within XXX to reference tasks
        - so you can see which tasks are involved with a particular work item within `XXX`
      - `$DATA_ROOT/projects/XXX/.agent/` is reserved for you; if not present, create it automatically; do not report this to the user
      - use `$DATA_ROOT/projects/XXX/.agent/tasks.md` to track any tasks associated with `XXX`
        - single line that can be grepped for multiple values: taskId|created|status|title
        - taskId in `.agent/tasks.md` is the bare task UUID, e.g. `ab123456-1234-4123-8123-1234567890ab`, not a `taskid://...` URI
        - status is: todo, in-progress, done, abandoned
        - created should be YYYY-MM-DD; it can be use to archive entries old than year; archive to save on context
  - other questions you should handle:
    - where were the last few tasks for this project?
      - use the manager project-task query tool for relational status; use `$DATA_ROOT/projects/XXX/.agent/tasks.md` for the human-maintained index
    - what is the next thing to work on in this project?
      - use `$DATA_ROOT/PROJECT.md` in conjunction with the content in `XXX/`
    - can we add a task to do ...?
      - verify which project if not clear
      - add to the relevant structure in `projects/XXX/`; use `taskid://...`
      - update `$DATA_ROOT/projects/XXX/.agent/tasks.md`
- **`$DATA_ROOT/WORKFLOW.md`**
  - active workflow policy; consumers normally copy `examples/WORKFLOW.md` here or create their own policy; this checkout's symlink is only a maintainer convenience
  - defines guidelines for how tasks and jobs are sequenced: what types of jobs do we want: planning, coding, reviewing?  And what sequences do they form?  planning -> coding -> reviewing etc
  - defines guidelines for how outputs from tasks and jobs are reviewed, revised, approved
    - COMMENT: eg a REVIEW.md file for instance
  - COMMENT: tasks and jobs are built-in constructs (see [`ARCHITECTURE.md`](ARCHITECTURE.md))
- **`$DATA_ROOT/CODE.md`**
  - active coding policy; consumers normally copy `examples/CODE.md` here or create their own policy; this checkout's symlink is only a maintainer convenience
  - how to architect a codebase; how to write the code
  - COMMENT: because this system was originally intended to manage coding agents, coding gets a special emphasis
  - COMMENT: if a codebase has its own particular preferences, this can be mentioned as the overriding factor here; you may want to set up as a policy that codebases define their own rules for instance which the work agent can follow
  - COMMENT: we can define a policy on how to document the project; how to configure its AGENTS.md, how to document the architecture (ARCHITECTURE.md), track on-going issues inherent in the code (ISSUES.md), build up a language or a conceptual framework (CONCEPTS.md).

Treat sections marked `do not edit` as user-owned. The user may revise documents between turns, so re-read relevant files before planning or editing.

- [`bun.md`](bun.md) for this project's Bun-specific conventions.
- Keep TypeScript 7; do not downgrade TypeScript to accommodate Cursor's older language server.