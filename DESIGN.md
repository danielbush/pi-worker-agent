# Pi Worker Agent Design

## Outcomes - do not edit

- /worker-example - use a real agent; manager agent is pi; worker agent is pi
- /worker-fake - uses fake agent; having a fake agent might help automated and interactive testing
- pi/pi works for real (not just `/worker-example`)
- add pi/cursor-agent
- we probably need some sort of dispatch profile;
  - example: I might want sol 5.6 high for planning; grok 4.5 high for work or qwen 3.8 etc; sol 5.6 medium for review, or claude even


## Intent - do not edit

Let's build /worker-example ensuring it conforms to ARCHITECURE.md (if we need to adjust ARCHITECTURE.md we can also do that).  Get a simple coding task working.  Include planning, coding, reviewing as 3 jobs within the task.
The system should capture not just OUTCOMES but the user's intent.
Then we can look at replacing /worker-demo with /worker-fake which can act as a live integration test.

---

You can edit from this point down...


## /worker-example

### Proposed behavior

`/worker-example` is a hardcoded, repeatable real-agent example. It creates a fresh small Bun project under `.examples/worker-example-<task-id>/`, initializes it as a git repository, and runs the workflow against that project. Generated example directories are ignored by git; `.examples/.gitignore` and `.examples/.gitkeep` keep the parent directory in the repository.

The hardcoded task is to implement and test a tiny greeting CLI:

- **Intent:** “I want a tiny Bun CLI that turns a supplied name into a friendly greeting. Keep it simple and tested.”
- **Outcomes:**
  - `bun run src/index.ts Ada` prints `Hello, Ada!`.
  - Running it without a name prints `Hello, world!`.
  - `bun test` passes.
- **Background:** the generated project contains a minimal package and starter source files, but not the finished behavior.

The command then:

1. Creates one task with three dependent Pi-worker jobs:
   - `plan` — inspect the project read-only and produce a plan.
   - `implement` — use the plan to make the change in `worktrees/<job-id>/`.
   - `review` — inspect the implementation and report findings without modifying it.
2. Starts each job only after its dependency completes successfully.
3. Returns immediately and shows task and job progress in the existing widget.
4. Notifies the user and managing agent when the task settles.
5. Uses `events.jsonl` to retrieve each job's conversation, tool activity, and final response.

For v0, the review job can inspect the implementation job's existing worktree. Commit capture, applying changes to the main checkout, review fixes, and follow-up prompts can come later.

### Build plan

- [ ] **Freeze the v0 contract**
  - Review the first-pass task and job status transitions in `ARCHITECTURE.md`.
  - [x] Make `request.md` canonical; do not store `jobs.instructions`.
  - Confirm the hardcoded greeting project and acceptance criteria.
- [ ] **Migrate the foundation to `ARCHITECTURE.md`**
  - Add `projects`, `tasks`, `jobs`, `workerSessions`, and `jobDependencies` tables.
  - Add paths and writers for `intent.md`, `outcomes.md`, `background.md`, `request.md`, and session `events.jsonl`.
  - Preserve `/worker-demo` while the new path is being built.
  - Add database, path, and event-log tests.
- [ ] **Add the Pi worker adapter**
  - Spawn `pi --mode json --print` in the correct project or worktree directory.
  - Restrict planning and review jobs to read-only tools; allow coding tools only in the implementation worktree.
  - Disable project extension discovery for workers so they cannot recursively invoke this extension.
  - Normalize Pi JSON output into `events.jsonl`.
  - Capture the Pi session ID and session file in `workerSessions`.
  - Test parsing with recorded fixtures so automated tests do not call a model.
- [ ] **Add dependency scheduling**
  - Start planning immediately.
  - Start implementation after planning succeeds and include the plan result as context.
  - Start review after implementation succeeds and point it at the implementation worktree.
  - Mark blocked downstream jobs when a dependency fails or is cancelled.
- [ ] **Wire `/worker-example` and acceptance-test it**
  - Generate and initialize the ignored Bun project under `.examples/`.
  - Create the task and three jobs.
  - Verify detached execution, restart-safe polling, widget updates, notifications, and stored files.
  - Run `bun test` and `bun run typecheck`.
  - Manually inspect whether the final review addresses the task's intent and outcomes.
- [ ] **Replace `/worker-demo` with `/worker-fake`**
  - Make the fake adapter emit the same normalized events as a real harness.
  - Use it for deterministic integration tests of scheduling, failure, cancellation, and notifications.

### Settled decisions

- `request.md` is the canonical job prompt.
- The `jobs` table stores query-friendly metadata such as the job title, but not full instructions.
