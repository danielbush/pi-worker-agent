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


## /worker-demo

### Behavior

`/worker-demo` is a hardcoded, repeatable Pi-manager/Pi-worker demonstration. It creates a fresh small Bun project under `.examples/worker-demo-<task-id>/`, initializes it as a git repository, and runs the workflow against that project. Generated demo directories are ignored by git.

The hardcoded task is to implement and test a tiny greeting CLI:

- **Intent:** “I want a tiny Bun CLI that turns a supplied name into a friendly greeting. Keep it simple and tested.”
- **Outcomes:**
  - `bun run src/index.ts Ada` prints `Hello, Ada!`.
  - Running it without a name prints `Hello, world!`.
  - `bun test` passes.
- **Background:** the generated project contains a minimal package and starter source files, but not the finished behavior.

The command first generates `taskId` in the application. It uses that same ID for the demo directory, the SQLite task record, and `tasks/<task-id>/`; neither SQLite nor the filesystem generates it. The generated directory is then registered as the task's project.

The command:

1. Creates the project, task, and three dependent Pi-worker jobs:
   - `plan` — inspect the project read-only and produce a plan.
   - `implement` — use the plan to make the change in `worktrees/<job-id>/`.
   - `review` — inspect the implementation and report findings without modifying it.
2. Starts each job after its dependency completes successfully.
3. Returns immediately and shows task and job progress in the widget.
4. Notifies the user and managing agent when the task settles.
5. Stores each worker session in the database and its observable activity in `events.jsonl`.

For v0, the review job inspects the implementation job's existing worktree. Commit capture, applying changes to the main checkout, review fixes, follow-ups, Cursor support, and dispatch profiles come later.

### Walking vertical slice (1): one real planning job

Before adding scheduling, implementation, or review, make `/worker-demo` execute one real Pi planning worker end-to-end:

1. Generate the greeting project and task.
2. Create one `plan` job and worker session.
3. Write the job's canonical `request.md`.
4. Launch a detached runner and return the task and job IDs immediately.
5. Have the runner spawn `pi --mode json --print` with read-only tools and extension discovery disabled.
6. Feed each Pi stdout line through `normalizePiJsonLine()`.
7. Append normalized events to the worker session's `events.jsonl`.
8. Store the Pi-native session ID in `workerSessions.harnessSessionId`.
9. Mark the job `completed` or `failed` in SQLite.

Definition of working:

```text
/worker-demo
→ real Pi process starts
→ job reaches completed
→ events.jsonl contains its response and tool activity
→ SQLite contains the project, task, job, and worker session
```

Do not add dependency scheduling, the implementation job, the review job, widgets, dispatch profiles, or Cursor support in this slice. Once this path works, extend it rather than creating another execution path.

