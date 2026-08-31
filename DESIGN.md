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

### Build plan

- [x] **Migrate the foundation to `ARCHITECTURE.md`**
  - [x] Add `projects`, `tasks`, `jobs`, `workerSessions`, and `jobDependencies` metadata bricks.
  - [x] Use the first-pass task and job statuses documented in `ARCHITECTURE.md`.
  - [x] Add OOP path and file-storage bricks for optional `intent.md`, optional `outcomes.md`, `background.md`, `request.md`, and session `events.jsonl`.
  - [x] Add database, path, and event-log tests.
- [x] **Generate the hardcoded demo project**
  - [x] Create `.examples/worker-demo-<task-id>/` from deterministic starter files.
  - [x] Initialize it as a git repository with a baseline commit.
  - [x] Register it as the task's project and create matching task files.
- [ ] **Add the Pi worker adapter**
  - Spawn `pi --mode json --print` in the project or implementation worktree.
  - Restrict planning and review to read-only tools.
  - Allow coding tools only in the implementation worktree.
  - Disable extension discovery so workers cannot recursively invoke this extension.
  - [x] Normalize representative Pi JSON output into canonical `WorkerEvent` records for `events.jsonl`.
  - Capture the Pi session ID and session file in `workerSessions`.
  - [x] Test normalization with a JSONL fixture; automated tests do not invoke a model.
- [ ] **Add dependency scheduling**
  - Start planning immediately.
  - Start implementation after planning succeeds, including the plan result as context.
  - Start review after implementation succeeds, pointing it at the implementation worktree.
  - Mark downstream jobs `skipped` when a dependency fails or is cancelled.
- [ ] **Implement `/worker-demo` and acceptance-test it**
  - Create the task and three jobs from the command.
  - Verify detached Pi execution, widget updates, notifications, and stored files.
  - Verify the generated project satisfies the hardcoded outcomes.
  - Verify the review addresses the task's intent and outcomes.
  - Run `bun test` and `bun run typecheck`.

### Settled decisions

- `/worker-demo` is hardcoded and uses real Pi workers.
- `request.md` is the canonical job prompt; `jobs` does not store full instructions.
- The first implementation targets Pi/Pi only while keeping harness boundaries reusable.
