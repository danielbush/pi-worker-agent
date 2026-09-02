# Project management

## Project structure

Projects use readable names. Each project has a `sequence.md` roadmap, a `backlog.md`, plus a document for the current vertical slice and each completed slice:

```text
projects/
└── <project-name>/
    ├── sequence.md
    ├── backlog.md
    ├── 01-<completed-slice>.md
    ├── 02-<completed-slice>.md
    └── 03-<next-slice>.md
```

Tentative later slices are brief entries in `sequence.md`, not separate files. Create a slice file only when an item becomes **Next**. Prefix slice filenames with their two-digit position in the sequence. When the path changes, renumber the affected slice files and update their links; the numbers describe the current intended order rather than permanent identity.

Each immediate project subdirectory maps to a synthetic row in SQLite `projects`, including its directory name, title, and optional recovery description. SQLite `projects_tasks` is the queryable source of task membership and status; `taskid://...` links and `.agent/tasks.md` remain human-readable references and indexes rather than relational authority. Codebase workspaces are independently authorized execution locations.

Intent and outcomes appear at project, slice, and task scope:

- **Intent** preserves the user's statement about why they want the work and the shape it should take. Preserve their wording where available; otherwise write a minimal faithful statement without inventing requirements.
- **Outcomes** are an explicit checklist of observable results. They describe what success looks like, not how to implement or test it.

Each narrower scope should be a faithful, self-contained refinement of its parent scope rather than an automatically synchronized copy.

## Project document format

`sequence.md` is the project-level contract and roadmap. Keep it high level:

```markdown
# Project title

## Intent

Preserve the user's statement about why they want the project and the shape it should take.

## Outcomes

- [ ] Observable project-level result.
- [ ] Another observable result.

## Next

- [Next slice](03-slice-nickname.md) — concise description of the increment to deliver now.

## Later — tentative

1. Possible later slice — one-sentence direction.
2. Another possibility — one-sentence direction.

## Completed

- [Completed slice](01-slice-nickname.md) — short description of the delivered result.
```

Only **Next** is committed enough to have a slice document. Freely revise, reorder, replace, or remove tentative later entries after learning from the next slice.

## Backlog policy

Use `$DATA_ROOT/projects/<project-name>/backlog.md` for concrete product or technical concerns that are worth retaining but are not part of the current vertical slice. The backlog belongs to the managed project rather than any one codebase workspace, and it is the single source of truth across the project's authorized workspaces. Do not duplicate it in a workspace-level `docs/backlog.md`.

The manager may add, edit, delete, and reprioritize backlog entries through narrow project-management tooling without enabling unrestricted development mode or creating a coding task. Backlog operations must be restricted to the selected registered project, validate the format below, preserve user comments, and report the resulting change clearly.

The backlog complements project sequencing; it does not replace `sequence.md`, choose what happens next, or turn speculative ideas into commitments.

Keep exactly these second-level sections, with bullet points beneath each:

```markdown
# Backlog

## feat

- **feat: Add a capability or user-visible behavior**
  - Relevant context and a possible solution direction.
  - COMMENT: A user comment preserved in their own words.

## refactor

- **refactor: Improve internal structure while preserving behavior**
  - Relevant context and affected concepts.

## fix

- **fix: Correct existing behavior**
  - Reproduction details, impact, and likely entry points.

## test

- **test: Verify behavior or installation in a real environment**
  - Scenario, expected result, and how findings will be recorded.

## chore

- **chore: Perform maintenance, tooling, dependency, or documentation work**
  - Relevant context and completion considerations.
```

Each top-level bullet must be a short, scannable, bold headline prefixed with the matching Conventional Commit type: `feat:`, `refactor:`, `fix:`, `test:`, or `chore:`. Within each section, order entries by descending priority: an item higher in the file has higher priority. Reorder entries when priorities change. A reader should get the gist from the headline alone. Put details in a small number of short nested bullets: usually the current problem, why it matters, and a promising direction. Include files or concepts only when they help someone resume the thread; avoid exhaustive design notes. Prefix nested user comments with `COMMENT: ` and preserve the user's wording where possible.

Prefer two to four nested bullets per item. Each item should contain enough detail to resume later without becoming a specification. Do not create empty task records for backlog items. When an item becomes current work, refine it into the **Next** slice's intent, outcomes, and `Try it`, create tasks as needed, and remove or update the backlog bullet.

## Relationship to the product workflow

[`WORKFLOW.md`](WORKFLOW.md) defines how the manager uses tasks, jobs, and dependencies to perform work. A project sequence sits above those constructs:

- A **project** is an ordered sequence of vertical slices.
- A **vertical slice** is one user-evaluable increment and may produce one or more tasks.
- A **task** is one objective contributing to the slice.
- A **job** is one delegated unit of work within a task.

This project-management policy uses vertical slices; another policy could use stories, tickets, or another sequencing style. Do not hardcode project-management transitions into task or job execution.

## Work in reality-tested vertical slices

- Build in small vertical slices that pass through the real system rather than completing one architectural layer at a time.
- Every slice must put something real in the user’s hands: a command they can run, an interface they can use, output they can inspect, or an end-to-end behavior they can observe.
- **`Try it` is essential to the definition of a vertical slice.** Write it before implementation or task creation. If the proposed result cannot yet be imagined as a concrete interaction, the slice is not ready to become **Next**.
- Write `Try it` as though the capability already exists: an immediate, present-tense walkthrough such as ask the manager to run the demo-task workflow for the current slice, observe its planning and code jobs, and exercise the result in the reported worktree.
- Treat `Try it` as a working-backwards artifact and a quick cognitive anchor, not merely as an acceptance test or optional release documentation. A reader returning to the project should be able to read it and immediately picture the experience being built.
- Use that imagined experience to shape the slice boundary, outcomes, and implementation choices. Keep it short and concrete enough to hold in mind while making trade-offs.
- A slice is not complete merely because its automated tests pass. Run the `Try it` path and put the result in the user’s hands for evaluation.
- `Try it` is a living working-backwards artifact, not a frozen prediction. Update it whenever discussion, implementation, or hands-on use produces a clearer or more useful way to picture the slice. Keep intent and outcomes aligned when the intended experience changes.
- Prefer the smallest end-to-end capability that touches reality over a larger collection of internally complete abstractions.
- Avoid building substantial infrastructure ahead of a usable path through it. Code that is well tested but has not yet participated in real behavior carries integration and product risk.
- After each slice, pause for user feedback before expanding the design. Use what was observed in practice to choose and shape the next slice.
- Keep each subsequent slice usable. Extend the working path without replacing it with a long period during which only internal components can be tested.

The strategy is to establish a visible, usable walking skeleton early and improve it through repeated cycles:

1. Choose one small user-observable outcome.
2. Implement the minimum end-to-end path that produces it.
3. Verify it with automated tests.
4. Put it in the user’s hands with clear instructions for trying it.
5. Gather feedback and use it to select the next slice.

## Vertical slice document format

The current slice document is the delivery contract for one user-evaluable increment:

```markdown
# Slice title

## Intent

Preserve the user's statement relevant to this increment. If there is no separate statement, write a minimal faithful refinement of the project intent.

## Outcomes

- [ ] Concrete, user-observable result.
- [ ] Another acceptance condition.

## Build

List the minimum end-to-end changes needed to produce the outcomes. Avoid unrelated infrastructure or future workflow stages.

## Tasks

- taskid://<uuid> — task title.

## Try it

Write as though the capability already exists. Give a short, concrete walkthrough of the commands or interactions and what the user sees in response. It should let someone immediately picture and try the intended experience, including how to inspect artifacts or output where relevant.
```

`Outcomes` state what must become observable. `Build` describes the proposed mechanism. `Try it` makes the intended experience feel concrete before it exists, so it can anchor discussion and implementation. It is required before the slice becomes **Next**, but it may be revised as the team learns and the intended experience becomes clearer. A slice may use one or more tasks; each task carries its own execution-level `intent.md`, `outcomes.md`, and `background.md` for its jobs.

At the end of the slice, run `Try it` and append:

```markdown
## Result

Record what the user could actually do and observe, any differences from `Try it`, and the feedback or decision that followed.
```

Update `Try it` during the slice when learning changes the intended experience. Use `Result` to record what happened when the current walkthrough was exercised, including remaining gaps and the user's response. When the user accepts the result or learning from the slice, retain the document as a durable record and move its link from **Next** to **Completed** in `sequence.md`. Then promote one tentative entry to **Next**, create its slice document, and refine its intent, outcomes, and `Try it` path with the user.
