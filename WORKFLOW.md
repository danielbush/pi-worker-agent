# Workflow

This file defines the default jobs and sequences the manager should use. The user may edit it to change how work is delegated.

## Job types

### `plan`

Inspect the project without modifying it. Return an actionable implementation plan covering files, behavior, and tests.

### `implement`

Make the requested changes in a new isolated worktree and run relevant tests. If a planning job exists, depend on it and incorporate its result into `request.md`.

### `review`

Inspect an implementation worktree without modifying it. Evaluate the diff and test results against the task intent and outcomes. Depend on the implementation being reviewed.

### `fix`

Address specific review findings in the implementation worktree and rerun relevant tests. Depend on the review that produced the findings.

### `test`

Run focused verification against an existing worktree without making product changes. Depend on the implementation or fix being tested.

## Coding flows

The manager chooses one of these flows based on the size and uncertainty of the task, then creates each next job only after evaluating the previous result.

### Small coding task

Use when the change is narrow, well specified, and does not need investigation before implementation.

```text
implement → review
```

1. Create `implement` with the task intent, outcomes, and relevant context.
2. After successful implementation, create `review` with a `reviews` dependency.
3. If review finds actionable problems, create `fix` with an `addresses-findings` dependency, then review again.
4. Complete the task when the outcomes are met and no further work is justified.

### Planned coding task

Use when the change is uncertain, spans multiple areas, or benefits from investigation and decomposition.

```text
plan → implement → review
```

1. Create `plan` to inspect the project and propose an implementation approach.
2. After accepting the plan, create `implement` with an `implements-plan` dependency and include the plan in its request.
3. After successful implementation, create `review` with a `reviews` dependency.
4. If review finds actionable problems, create `fix` with an `addresses-findings` dependency, then review again.
5. Complete the task when the outcomes are met and no further work is justified.

## Dependency rules

- Dependencies must belong to the same task and must not form cycles.
- Record dependencies even when the earlier job is already complete.
- A dependency records the result that informed or gates the new job; it does not create the new job automatically.
- Use descriptive relationships such as `implements-plan`, `reviews`, `addresses-findings`, and `verifies`.
- Include relevant dependency results in the new job's canonical `request.md`.
- If a required job fails or is cancelled, do not continue the sequence automatically; reassess the task first.
