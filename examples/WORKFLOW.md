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

## Default job profiles

The manager uses these profiles unless the task explicitly overrides a harness, logical model, or effort value for a job purpose:

```yaml
plan:
  model: gpt-5.6-sol
  effort: high
  harness: pi

implement:
  model: cursor-grok-4.5
  effort: high
  harness: cursor-agent

review:
  model: gpt-5.6-sol
  effort: medium
  harness: pi
```

Logical model and effort values are owned by this policy. Harness adapters map them to native selectors, such as `openai-codex/gpt-5.6-sol` plus separate Pi effort or Cursor's effort-bearing `cursor-grok-4.5-high`. Missing mappings fail closed. Trusted execution capabilities remain application-enforced and cannot be expanded by a task override.

## Coding flow

### Default coding task

Coding tasks use planning and review by default:

```text
plan → implement → review
```

1. Create a task with explicit intent, outcomes, and background, associate it with the managed project, reference it from the current slice with `taskid://<uuid>`, and update the project's `.agent/tasks.md` index.
2. Create a read-only `plan` job.
3. After successful planning, the manager evaluates the result and creates an `implement` job with an `implements-plan` dependency. Include the accepted plan in its canonical `request.md`.
4. Run implementation in an isolated worktree.
5. After successful implementation, the manager evaluates the result and creates a read-only `review` job with a `reviews` dependency against that worktree.
6. If review finds actionable problems, create a `fix` job with an `addresses-findings` dependency, then review the fix.
7. Complete the task only when its outcomes are met and no further work is justified.

Planning and review are policy defaults, so their successful transitions do not require separate user prompts. The manager still evaluates and persists each transition individually; a runner does not infer or create jobs merely because another job exited.

A failure or ambiguous result stops automatic continuation for manager reassessment.

### User-requested variations

The user may explicitly modify the default for a task:

- **No planning:** `implement → review`
- **Skip review:** `plan → implement`
- **No planning and skip review:** `implement`

Treat these as explicit task-level workflow choices. Do not infer them merely because work appears small or urgent.

## Dependency rules

- Dependencies must belong to the same task and must not form cycles.
- Record dependencies even when the earlier job is already complete.
- A dependency records the result that informed or gates the new job; it does not create the new job automatically.
- Use descriptive relationships such as `implements-plan`, `reviews`, `addresses-findings`, and `verifies`.
- Include relevant dependency results in the new job's canonical `request.md`.
- If a required job fails or is cancelled, do not continue the sequence automatically; reassess the task first.
