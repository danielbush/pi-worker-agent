# Project management

## Project structure

Projects use readable names, and their vertical slices use short nicknames:

```text
projects/
└── <project-name>/
    ├── sequence.md
    ├── 01-<slice-nickname>.md
    ├── 02-<slice-nickname>.md
    └── ...
```

Prefix each slice nickname with its two-digit position in the sequence. When the path changes, renumber the affected slice files and update their links; the numbers describe the current intended order rather than permanent identity.

`sequence.md` defines the ordered path through the project. It stays high level and links to each vertical-slice file:

```markdown
# Project title

## Outcomes

Ideally user-generated statement about what they want to see.  This may get refined over time.

## Next

- [Next slice](03-slice-nickname.md) — the outcome to deliver now.

## Later — tentative

1. [Possible later slice](04-slice-nickname.md) — one-sentence direction.
2. [Another possibility](05-slice-nickname.md) — one-sentence direction.

## Completed

- [Completed slice](01-slice-nickname.md) — short result.
```

Only the next slice is non-tentative and should be fully described using the vertical-slice format below. Every later slice is speculative: keep its file brief, and freely revise, reorder, replace, or remove it after learning from the next slice.

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
- A slice is not complete merely because its automated tests pass. Automated tests are necessary, but the user must also have a concrete way to exercise the result and evaluate whether it is useful.
- State the user-facing acceptance path before implementing a slice. Keep it short and specific, for example: run `/worker-demo`, observe a detached planning job complete, and inspect its result with `/worker-status`.
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

## Vertical slice format

Describe each proposed slice using this format:

### User-visible outcome

State the concrete capability the user will receive and be able to evaluate.

### Build

List the minimum end-to-end changes needed to produce that outcome. Avoid unrelated infrastructure or future workflow stages.

### Try it

Give exact commands or interactions the user can perform. Include how to inspect artifacts or output directly where relevant.
