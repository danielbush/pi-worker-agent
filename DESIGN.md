# Pi Worker Agent Design

## Outcomes - do not edit

- /worker-demo - use a real agent; manager agent is pi; worker agent is pi
- add pi/cursor-agent
- we probably need some sort of dispatch profile;
  - example: I might want sol 5.6 high for planning; grok 4.5 high for work or qwen 3.8 etc; sol 5.6 medium for review, or claude even


## Intent - do not edit

Let's build /worker-demo ensuring it conforms to ARCHITECURE.md (if we need to adjust ARCHITECTURE.md we can also do that).  Get a simple coding task working.  Include planning, coding, reviewing as 3 jobs within the task.
The system should capture not just OUTCOMES but the user's intent.

---

You can edit from this point down...


## Current direction

The earlier `/worker-demo` direction above is retained as user-owned history. The user has since replaced the hardcoded command with managed-project development through `DATA_ROOT/projects/pi-worker-agent/`.

The system is now built by using it to manage this repository itself:

- `PROJECT_MANAGEMENT.md` selects and defines the current vertical slice.
- The manager derives durable tasks from the slice's intent and outcomes.
- `WORKFLOW.md` tells the manager how to sequence jobs and evaluate each result.
- Workers operate against the registered repository workspace and use isolated worktrees for code changes.
- The slice's `Try it` walkthrough is the working-backwards anchor for the experience being built.

The policy-defined **Demo task** workflow replaces `/worker-demo`. Its first form is:

```text
plan → code (`implement` job)
```

The manager creates and evaluates each job explicitly. The runner does not hardcode the transition. The coding target is a small greeting CLI under `demo/greeting-cli/` in an isolated worktree, allowing the task and job machinery to be exercised without changing product code.

The following vertical slice will extend the same workflow to:

```text
plan → code → review
```

See `DATA_ROOT/projects/pi-worker-agent/sequence.md` and its **Next** slice for the current intent, outcomes, build scope, tasks, and `Try it` walkthrough.
