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

## Execution configuration

Agent profiles and job types are durable manager-configured prerequisites rather than structured data embedded in this policy. Before creating task work, use the execution-catalog manager tools to configure:

- active agent profiles with harness-native model and option values;
- active job types with trusted capabilities, worktree strategies, and non-null default agent profiles.

Default profiles should use a harness that already launches. If creating or running a job fails because its harness is unavailable, unverified, or otherwise cannot start, stop that transition. Do not retry the same failing harness. Report the failure and suggest an active profile on a harness that already works, typically Pi; continue only after explicitly selecting another profile for the next job or after a later successful verification of the harness.

A delegation may explicitly select another active agent profile for that job; otherwise it uses the job type's default. Call `worker_list_models` before configuring or explicitly selecting a Cursor profile and use only a returned model id. Job creation fails closed if a selected pin is missing. Trusted execution capabilities and worktree strategies belong to job types and cannot be changed by selecting another profile.

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
7. Complete the task only when its outcomes are met and no further work is justified. If it is the final task delivering the current vertical slice, first present the slice's Demo to the user and wait for the user to perform or directly observe it and provide feedback; worker verification and manager inspection do not substitute for the user's Demo.

Planning and review are policy defaults, so their successful transitions do not require separate user prompts. The manager still evaluates and persists each transition individually; a runner does not infer or create jobs merely because another job exited.

A failure or ambiguous result stops automatic continuation for manager reassessment.

### Merging completed work

When an implementation is ready under the selected workflow, the manager says that the job has finished and asks whether the user wants to merge it into the project. The user may approve, ask to look at it first, or leave it unmerged for later.

If the user asks to inspect or look at completed work, show a readable result summary, changed files, test results, review findings when present, and the diff. Also open the completed implementation's derived worktree using the editor named by `EDITOR`, so the user can browse the actual code. If `EDITOR` is unset or cannot launch, give a helpful setup message and leave the work unmerged. Say **diff** or **`git diff`**, not invented variants. Inspection must not modify the project workspace and does not imply approval.

Call the narrow merge tool only after the user explicitly approves in conversation. Do not ask for a redundant second confirmation. The tool must derive source and destination from the completed implementation job, fail closed for unsafe Git state, report the resulting destination commit, and remove the detached implementation worktree only after the merge succeeds. Unmerged work and failed merges retain their worktrees. Do not manually copy files, run arbitrary Git commands, or treat task completion as merge approval.

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
