# Architecture

A user gives the manager a request. The manager combines policy, workflow
defaults, model routing, and any one-off choice to resolve the jobs; records the
task and state in the project control record; sends each worker a focused
`JobBrief`; and verifies its report and workspace changes before updating the
project and root task indexes.

## System boundaries

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#080d18", "primaryColor": "#172554", "primaryTextColor": "#f8fafc", "primaryBorderColor": "#60a5fa", "secondaryColor": "#111827", "secondaryTextColor": "#f8fafc", "secondaryBorderColor": "#94a3b8", "tertiaryColor": "#0f172a", "tertiaryTextColor": "#f8fafc", "tertiaryBorderColor": "#475569", "lineColor": "#94a3b8", "textColor": "#f8fafc", "titleColor": "#f8fafc", "clusterBkg": "#0f172a", "clusterBorder": "#475569", "edgeLabelBackground": "#080d18"}}}%%
flowchart TB
    subgraph TOP[" "]
        direction LR

        subgraph CONFIG["Configuration and policy"]
            direction TB
            AG["AGENTS.md<br/>ownership and lifecycle rules"]
            WF["policies/WORKFLOWS.md<br/>job sequences, concrete profiles,<br/>preferred roles"]
            MC["models.json<br/>provider-specific routes and aliases"]
        end

        subgraph RESOLUTION["Per-run resolution — not persisted as override syntax"]
            direction TB
            RS(["Resolve preferred role<br/>and one-off profile choice"])
            RJ["Resolved jobs<br/>harness, model, thinking, route"]
            RS --> RJ
        end

        U(["User<br/>request, choice, approval, check-in"])
    end

    subgraph MIDDLE[" "]
        direction LR
        M(["Manager agent<br/>resolve, authorize, coordinate,<br/>verify, record"])
    end

    subgraph OPERATIONS[" "]
        direction LR

        subgraph CONTROL["projects/project-name/ — manager-owned control record"]
            direction TB
            CR(["Control-record I/O boundary"])
            PC["README.md<br/>workspace options, commands, constraints"]
            ST["state.json<br/>canonical latest 20 runs"]
            T["tasks/<date>--<slug>/00-task.md<br/>dated task specification"]
            RP["tasks/<date>--<slug>/NN-job.md<br/>reserved worker result"]
            LG["tasks/<date>--<slug>/logs/...jsonl<br/>external harness event stream"]
            TL["TASKS.md<br/>generated project index"]
            HI["history.jsonl<br/>append-only older runs"]

            PC --> CR
            CR --> T
            CR --> ST
            RP --> CR
            LG --> CR
            ST --> TL
            ST -->|"archive after 20"| HI
        end

        subgraph EXECUTION["One worker per job"]
            direction TB
            B["JobBrief — in-memory prompt data<br/>objective: str<br/>workspace: absolute Path<br/>task_file: Path<br/>input_reports: list of Path<br/>report_file: one reserved Path<br/>allowed_commands: list of str<br/>protected_paths/actions: list of str"]
            RLM(["RLM child<br/>agent messaging and observation"])
            EXT(["External harness<br/>managed nonblocking process"])
            HB(["Internal heartbeat<br/>external monitoring only"])
            B --> RLM
            B --> EXT
            B -.-> HB
            HB -.-> EXT
        end

        subgraph WORKSPACE["Selected external workspace"]
            direction TB
            WS["Exact directory, checkout, or worktree"]
            FILES["Project files and tests"]
            GIT["Selected Git worktree identity"]
            WS --- FILES
            WS --- GIT
        end
    end

    ROOT["root TASKS.md<br/>generated cross-project index"]

    style TOP fill:none,stroke:none
    style MIDDLE fill:none,stroke:none
    style OPERATIONS fill:none,stroke:none

    classDef data fill:#172554,stroke:#60a5fa,stroke-width:2px,color:#eff6ff
    classDef process fill:#111827,stroke:#94a3b8,stroke-width:1px,stroke-dasharray:5 4,color:#f1f5f9
    classDef actor fill:#431407,stroke:#fb923c,stroke-width:2px,color:#fff7ed

    class AG,WF,MC,RJ,PC,ST,T,RP,LG,TL,HI,B,WS,FILES,GIT,ROOT data
    class RS,CR,RLM,EXT,HB process
    class U,M actor

    TOP ~~~ MIDDLE
    MIDDLE ~~~ OPERATIONS

    U <--> M
    AG --> M
    WF --> RS
    MC --> RJ
    M -.-> RS
    RJ --> M

    M <-->|"read / write"| CR
    M --> B
    M -->|"select"| WS

    RLM --> WS
    EXT --> WS
    RLM --> RP
    EXT --> RP
    EXT --> LG
    WS -->|"verify"| M

    ST --> ROOT
```

The diagram uses visual weight to emphasize data:

- **Dark blue, square, solid boxes** are data or durable artifacts.
- **Charcoal, rounded, dashed boxes** are processes or runtime components.
- **Dark orange pills** are actors.

All diagram text, group titles, edges, and labels use a forced dark palette with
light foreground colors, independent of the page theme.

Arrow labels are limited to boundary operations where direction alone is not
enough. Group outlines show ownership or placement, not additional processes.


## Configuration entities

Entity relationship diagram of the configuration and run entities. Profiles,
workflow roles, job types, and workflows are defined in
`policies/WORKFLOWS.md`; runs and jobs are defined in `AGENTS.md` and live in
`projects/<name>/state.json`.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#080d18", "primaryColor": "#172554", "primaryTextColor": "#f8fafc", "primaryBorderColor": "#60a5fa", "secondaryColor": "#111827", "secondaryTextColor": "#f8fafc", "secondaryBorderColor": "#94a3b8", "tertiaryColor": "#0f172a", "tertiaryTextColor": "#f8fafc", "tertiaryBorderColor": "#475569", "lineColor": "#94a3b8", "textColor": "#f8fafc", "titleColor": "#f8fafc", "clusterBkg": "#0f172a", "clusterBorder": "#475569", "edgeLabelBackground": "#080d18"}}}%%
erDiagram
    PROFILE {
        string name  "role/model[/route]"
        string harness  "rlm | cursor-agent"
        string model
        string thinking  "low | medium | high"
        string route  "nullable"
    }
    WORKFLOW_ROLE {
        string name  "planning | coding | reviewing"
    }
    JOB_TYPE {
        string name  "investigate | plan | implement | mock | review"
        string purpose
        string inputs
        string output
    }
    WORKFLOW {
        string name  "investigate | build | build-no-plan | quickfix | mockup | review-only"
        string approval  "required"
    }
    RUN {
        string run_id
        string status
        string approved  "timestamp, nullable"
    }
    JOB {
        int nn  "execution order"
        string status
        string session_id  "canonical harness-native id for new writes"
        string harness_session  "legacy alias; still present in real state"
    }

    WORKFLOW_ROLE ||--|| PROFILE : "preferred profile"
    JOB_TYPE }o--|| WORKFLOW_ROLE : "selects role"
    WORKFLOW ||--|{ JOB_TYPE : "jobs sequence"
    WORKFLOW ||--o{ RUN : "instantiated as"
    RUN ||--|{ JOB : "runs in order"
    JOB }o--|| JOB_TYPE : "is a"
    JOB }o--|| PROFILE : "resolved to (recorded as actual fields)"
```

Rules that the diagram does not show:

- A run may pick a different concrete profile for one job (per-run execution
  choice); state records the resolved `harness`, `model`, `thinking`, `route`,
  never the selector.
- Retries and revisions are new numbered `JOB` rows in the same `RUN`.
- `approval: required` means a `RUN` cannot leave `awaiting-approval` until
  the user approves its `00-task.md`.

### Example: one task on disk

A task is a directory; everything it produces hangs off it by path. Using a
mock project and a title-derived slug:

```
projects/my-project/tasks/2026-01-15--fix-dashboard-sorting/
  00-task.md                     # the approved spec (manager-owned;
                                 #   frontmatter: run_id, title, created,
                                 #   status, workflow, workspace)
  01-implement.md                # first attempt (frontmatter: author, role,
                                 #   date, session_id)
  02-review.md                   # FAIL — issues found
  03-implement.md                # fixes from the review feedback
  04-review.md                   # PASS
  05-review.md                   # your review (author: user), written up by
                                 #   the manager: one more tweak
  06-implement.md                # the tweak
  logs/
    01-implement.cursor-agent.jsonl
    03-implement.cursor-agent.jsonl
    06-implement.cursor-agent.jsonl
```

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#080d18", "primaryColor": "#172554", "primaryTextColor": "#f8fafc", "primaryBorderColor": "#60a5fa", "secondaryColor": "#111827", "secondaryTextColor": "#f8fafc", "secondaryBorderColor": "#94a3b8", "tertiaryColor": "#0f172a", "tertiaryTextColor": "#f8fafc", "tertiaryBorderColor": "#475569", "lineColor": "#94a3b8", "textColor": "#f8fafc", "titleColor": "#f8fafc", "clusterBkg": "#0f172a", "clusterBorder": "#475569", "edgeLabelBackground": "#080d18"}}}%%
erDiagram
    PROJECT_DIR {
        path dir "projects/my-project/"
    }
    TASK_DIR {
        path dir "tasks/2026-01-15--fix-dashboard-sorting/"
    }
    TASK_MD {
        path file "00-task.md"
    }
    JOB_MD {
        path file "NN-job.md"
        string nn "execution order; retries get the next number"
    }
    LOG_JSONL {
        path file "logs/NN-job.harness.jsonl"
    }

    PROJECT_DIR ||--o{ TASK_DIR : "has zero or more"
    TASK_DIR ||--|| TASK_MD : "has exactly one"
    TASK_DIR ||--|{ JOB_MD : "has one or more"
    TASK_DIR ||--o{ LOG_JSONL : "has zero or more (external harnesses)"
```

The cardinality that matters: **one task directory, many numbered output
files** — and the numbering is the conversation. The example above shows both
loops: implement↔review (01–04) and user↔implement (05–06), all inside one
task directory.
Revisions and retries never overwrite — attempt N's feedback produces report
N+1 in the same task directory, so the directory is a complete, ordered
record of how the work converged.

Output files may instead be organized into one-level **tracks**: immediate
subdirectories `NN-<description>/` (two digits from 00, lowercase hyphenated
description) that hold job files in the same `MM-<jobtype>.md` format as direct
job files, each track numbering its own files from `MM` 00. A task spec
(`00-task.md`) may sit at the task root or inside a track. Track membership is
never stored separately: the manager records nested `task_file` / `report_file`
paths — `tasks/<date>--<slug>/<NN>-<description>/<MM>-<jobtype>.md` — and the
project index derives the run's tracks from those recorded paths, so grouping is
a file move plus a `StateStore` path update and a worker's one reserved report
may be assigned inside a track.

The numbered `NN-*.md` files hold **outputs** from anyone who contributes
to the task — implementers and reviewers. A personal review by the user is
just another review: `NN-review.md` with frontmatter `author: user`, written
up by the manager from the user's feedback, and — like any review — fed back
to the implementer as the next attempt's input. New worker reports also carry
`session_id` matching that job's canonical `session_id` in `state.json`.
Existing jobs may already store the same kind of identifier as
`harness_session`; leave those values in place. User reviews omit it.
**Inputs** — the spec, open design questions — stay outside: `00-task.md` is
manager-owned.

---

## Request and job resolution

A workflow defines job order using preferred roles. The Preferred profiles table
maps each role to a concrete `role/model[/route]` profile, which bundles a
harness, model selector, thinking level, and optional provider route. A one-off
concrete-profile choice changes one job for one run; it does not create another
workflow.

Override-like YAML shown in `policies/WORKFLOWS.md` is request notation only. The manager
must never copy a `job_overrides` object or profile selector into `state.json`.
Before creating a run, it resolves every job and stores only actual execution
values:

```json
{
  "job": "implement",
  "harness": "rlm",
  "model": "openrouter-morph/moonshotai/kimi-k3",
  "thinking": "medium",
  "route": "morph/fp4",
  "status": "pending",
  "session_id": "<harness-native identifier>",
  "report_file": "tasks/2026-09-06--build-python-task-tracker-kimi-comparison/01-implement.md"
}
```

These resolved values are historical facts. Later edits to a concrete profile or
preferred-role mapping do not change an existing run. A retry inherits the prior execution choice unless the
user explicitly requests another one. Each attempt records what it actually
used.

Provider routing is part of model configuration, not an `rlm()` argument.
OpenRouter routes use model overrides or routed provider aliases in
`~/.prime/agent/models.json`. A configuration change requires `/reload` before
the selector is used.

## Run lifecycle

1. Resolve the project, workflow, and actual execution fields for every job.
2. Select and verify the exact workspace. When Git is present, verify both the
   worktree root and common Git directory; never silently substitute another
   checkout.
3. Create the task directory and manager-owned `00-task.md` before launching
   a worker.
4. Add the run and resolved jobs to `state.json`, then regenerate project and
   root indexes.
5. Launch one worker per job, in workflow order unless jobs are independent.
6. Read the assigned report and inspect the workspace. A successful process
   exit alone is not completion.
7. Run only authorized verification commands. Update state and indexes at each
   status change.
8. If review fails, return to the implementation job with the review report as
   input. After two failed review attempts, block the run and check in with the
   user before starting more implementation or review work.
9. On success or terminal failure, record timestamps and a concise outcome.

## Worker isolation

Every worker receives a minimal brief rather than the complete project control
record. `JobBrief` is a conceptual in-memory structure that the manager renders
into the worker prompt; it is not another file or a structure copied into
`state.json`:

```text
JobBrief
  objective: str                 # job goal and acceptance criteria
  workspace: absolute Path       # only project execution root
  task_file: Path                # manager-owned task specification
  input_reports: list[Path]      # authoritative outputs from earlier jobs
  report_file: Path              # sole control-record write target
  allowed_commands: list[str]    # authorized mutating/project commands
  protected_paths: list[Path]    # files and trees that must not change
  prohibited_actions: list[str]  # branch, credential, network, or other limits
```

The referenced files remain the durable data. The prompt contains their paths,
not copied file objects. The fields mean:

- **Objective:** one job objective plus its acceptance criteria and relevant
  constraints;
- **Workspace:** the exact absolute execution path and an instruction to change
  into it first;
- **Inputs:** the manager-owned `00-task.md` path and paths to required earlier job
  reports, never in-memory objects or unrelated run context;
- **Output:** exactly one reserved `tasks/<date>--<slug>/<NN>-<job>.md` path;
- **Authorization:** the exact install, dependency, generation, build, test,
  typecheck, migration, deployment, service, and Git-mutating commands allowed
  for that job; read-only discovery is allowed unless project policy says
  otherwise; and
- **Protection:** paths, branches, competing implementations, credentials, and
  external actions the worker must not access or modify.

Workers modify only the selected workspace. Their sole write permission in the
control record is their assigned report. Workers must not edit `README.md`,
`state.json`, `TASKS.md`, `history.jsonl`, `task.md`, another report, or run
metadata.

Independent comparison workers must not inspect competing branches or their
reports.

## RLM and external harnesses

### RLM workers

An RLM spawn returns a child handle immediately. That handle name/id (for
example `sub-2dd9cc39`) is not the worker session identifier. Record the
Prime Agent session id surfaced by agent messaging or the subagent roster
(for example `01a07f55-0ac2-7108-875c-ac27a2f0a791` on the
`2026-09-08-1436-manual` implement job) as `session_id` as soon as it is
available, and put the same value on that attempt's report frontmatter.
Retries and later jobs record their own identifiers. Completion arrives through
agent messaging; bounded observation can inspect progress. Short RLM jobs do
not need a heartbeat. Add one only for work expected to be long, silent, or in
need of stall detection. `session_id` is the canonical field for new writes;
`harness_session` is a coexisting legacy alias already present in real state.
Keep both readable. Jobs and reports with neither field remain valid; do not
backfill.

### External workers

A process such as `cursor-agent` is not an RLM child. It has no agent messaging,
family roster, or observation channel. When such a harness is selected, the
manager conditionally loads `.agents/skills/run-external-worker/SKILL.md` and:

- starts it nonblockingly and retains its process handle;
- writes its `stream-json` output to a durable run log;
- records the harness, exact model, log path, process metadata, and
  harness-native `session_id` (Cursor/Claude stream-json `session_id`, Codex
  `thread.started` id) as soon as it appears, matching the report frontmatter.
  Current records may already carry the same kind of identifier as
  `harness_session`; leave those values. New writes use `session_id` only;
- creates a two-minute internal follow-up heartbeat immediately;
- polls without blocking and reads only the durable log tail;
- reports only meaningful progress, blockers, or completion; and
- deletes the heartbeat after terminal verification.

The heartbeat is an ephemeral scheduler. `state.json`, the harness log, captured
session ID, assigned report, and workspace are the recovery record. Raw logs
are audit material and are not normal input to later jobs; later jobs read the
written report.

## Storage and consistency

| Data | Purpose | Writer |
|---|---|---|
| `projects/<name>/README.md` | Stable workspace choices, commands, and constraints | Manager |
| `state.json` | Canonical machine-readable latest 20 runs | Manager |
| project `TASKS.md` | Generated view of one project state | Manager |
| root `TASKS.md` | Generated cross-project view | Manager |
| `history.jsonl` | Append-only complete runs older than the latest 20 | Manager |
| `tasks/<date>--<slug>/00-task.md` | Dated request and acceptance specification | Manager |
| `tasks/<date>--<slug>/<NN>-<job>.md` | Authoritative result for one execution | Assigned worker |
| `tasks/<date>--<slug>/logs/*.jsonl` | Durable external harness event stream | External harness via manager launcher |
| external workspace | Project implementation and tests | Authorized worker |

Report numbers are global within a run and reflect actual execution order across
job names and retries. A report path is reserved atomically and is never reused
or overwritten by another attempt.

State replacement and generated indexes use atomic writes. Same-project state
and project-index work is serialized with a project lock. Cross-project root
index generation uses a separate root lock with a consistent lock order.
History append and state replacement form a multi-file transaction boundary;
recovery must reconcile an interrupted archive operation before any later
mutation and must keep history content consistent with the `archived` counter.

`state.json` is the only source of truth for current runs. `TASKS.md` files are
rebuildable views. Do not read all of an unbounded state or history file into
model context; load state into code and display only relevant slices, and read
only history tails or targeted matches.

## Status and completion

Run statuses are `queued`, `running`, `blocked`, `done`, `failed`, and
`cancelled`. Job statuses are `pending`, `running`, `done`, `failed`, and
`skipped`; legacy stored `queued` reads as `pending`.

Transitions must preserve run/job consistency and refresh retry timestamps. A
run cannot be complete while a required job is active or failed. Completion
requires all of the following:

- a usable assigned report;
- manager inspection of the workspace;
- authorized verification results;
- consistent durable state and generated indexes; and
- a user-facing outcome.
