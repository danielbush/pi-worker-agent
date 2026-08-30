# Pi Worker Agent Design

## Goal

Use the current Pi harness as a managing agent that can delegate coding, planning, and investigation tasks to detached workers running in other harnesses, initially:

- Cursor Agent
- Codex CLI
- Pi

Workers must be independently trackable, survive Pi reloads or exits, and notify both the managing agent and the user when they finish.

## Architecture

```text
Current Pi session
  └─ worker_* extension tools
       ├─ start a detached worker runner
       ├─ record the job in SQLite
       └─ return a job ID immediately

Detached Bun runner
  ├─ starts cursor-agent, codex, or pi
  ├─ parses structured output
  ├─ records events and the harness session ID
  └─ updates SQLite when the process finishes

Pi extension monitor
  ├─ polls or subscribes to the durable job registry
  ├─ watches jobs owned by the current Pi session
  ├─ updates a TUI widget
  ├─ displays a user notification on completion
  └─ makes completed results available to the managing agent
```

Use `bun:sqlite` for the durable registry and a detached Bun runner for each job. SQLite is the source of truth; the child process itself is not the source of truth.

## Pi extension tools

Expose the following tools to the managing agent:

- `worker_start` — launch a worker and return its job ID immediately.
- `worker_list` — list queued, running, completed, failed, and cancelled workers.
- `worker_get` — retrieve status, recent events, final output, transcript paths, and changes.
- `worker_cancel` — terminate a running worker.
- `worker_followup` — resume the underlying Cursor, Codex, or Pi session with another prompt.
- `worker_apply` — inspect and apply or cherry-pick a coding worker's result.

Example request:

```json
{
  "harness": "codex",
  "role": "investigator",
  "task": "Find the cause of the flaky auth tests",
  "cwd": "/path/to/repo",
  "isolation": "read-only"
}
```

`worker_start` should return quickly:

```json
{
  "jobId": "job_01J...",
  "status": "queued",
  "harness": "codex"
}
```

The managing agent should not hold a tool call open for the full duration of a background task.

## Harness adapters

### Cursor Agent

For investigation or planning:

```bash
cursor-agent \
  --print \
  --output-format stream-json \
  --workspace "$cwd" \
  --trust \
  --mode plan \
  "$prompt"
```

For session tracking, create the chat first and save its ID:

```bash
cursor-agent create-chat
cursor-agent \
  --resume "$chat_id" \
  --print \
  --output-format stream-json \
  "$prompt"
```

Cursor also supports `--worktree`, which can isolate coding workers.

### Codex CLI

For investigation:

```bash
codex exec \
  --json \
  -C "$cwd" \
  --sandbox read-only \
  --ask-for-approval never \
  "$prompt"
```

For coding:

```bash
codex exec \
  --json \
  -C "$worktree" \
  --sandbox workspace-write \
  --ask-for-approval never \
  "$prompt"
```

The JSON event stream includes the Codex thread/session ID. Follow-ups can resume it:

```bash
codex exec resume "$thread_id" --json "$prompt"
```

Recent Codex versions also provide `codex queue --thread ...`, which may support steering an active session.

### Pi workers

Use JSON mode for one-shot workers:

```bash
pi --mode json -p --no-session "$prompt"
```

Use RPC mode for a long-lived, steerable Pi worker:

```bash
pi --mode rpc
```

Pi's `examples/extensions/subagent/` implementation is a useful reference for streaming, cancellation, parallelism, rendering, and usage accounting. Unlike that synchronous example, this design returns a job ID immediately and keeps durable state outside the tool call.

## Durable data model

### Jobs

Each job should record at least:

```text
id
parent_pi_session_id
parent_pi_session_file
harness
harness_session_id
role
task
cwd
worktree
status
pid
created_at
started_at
finished_at
exit_code
result_path
transcript_path
error
```

Suggested statuses:

```text
queued -> starting -> running -> completed
                              -> failed
                              -> cancelled
                              -> orphaned
```

### Events

Keep append-only events for progress and diagnostics:

```text
id
job_id
sequence
timestamp
type
payload_json
```

Example event types:

```text
job.started
harness.session.discovered
assistant.delta
tool.started
tool.finished
job.completed
job.failed
job.cancelled
```

### Deliveries

Track whether a completion has been delivered to a particular Pi session:

```text
job_id
parent_pi_session_id
delivery_type
delivered_at
```

This prevents duplicate notifications while allowing undelivered completions to be replayed after Pi restarts.

## How detached completion reaches the managing Pi session

A detached process cannot safely call methods on the Pi extension directly. The extension may have reloaded, switched sessions, crashed, or exited. Communication therefore goes through durable state.

### 1. The extension creates the job

When `worker_start` runs, the extension:

1. Generates a stable internal job ID.
2. Inserts a `queued` job row with the current `ctx.sessionManager.getSessionId()` and session file.
3. Starts a detached Bun runner and passes it the job ID.
4. Returns the job ID to the managing agent.

### 2. The detached runner owns process observation

The runner starts the selected harness with stdout and stderr pipes. It:

- Changes the job to `running`.
- Stores the operating-system PID.
- Parses JSONL or stream-JSON events.
- Captures the Cursor chat ID, Codex thread ID, or Pi session ID.
- Appends progress events and writes a complete transcript.
- Writes the final response to a result file.
- Atomically changes the job to `completed`, `failed`, or `cancelled` after the child exits.

The runner performs the final database update even when no Pi process is running.

### 3. The Pi extension monitors the registry

On Pi's `session_start` event, the extension starts an interval or database monitor. For example, every second it queries:

```sql
SELECT *
FROM jobs
WHERE parent_pi_session_id = ?
  AND status IN ('queued', 'starting', 'running', 'completed', 'failed')
ORDER BY created_at;
```

The monitor is started from `session_start`, not from the extension factory. It is stopped in `session_shutdown` to avoid leaked timers across `/reload`, `/new`, `/resume`, `/fork`, and exit.

A one-second SQLite poll is simple and sufficient for an MVP. A later daemon could publish events over a Unix socket or server-sent events for lower latency, while SQLite remains the durable source of truth.

### 4. The extension detects a terminal transition

The extension keeps a small in-memory cache of the last observed job status. When it sees:

```text
running -> completed
running -> failed
running -> cancelled
```

it performs two separate actions:

1. Notify the human through Pi's UI.
2. Make the result available to the managing agent.

It then records delivery so the same completion is not announced repeatedly.

### 5. Restart and missed-event behavior

On startup or session resume, the monitor also queries for terminal jobs without a delivery record. This means:

- If Pi remained open, completion appears within the polling interval.
- If Pi was closed, the runner still records completion.
- When the owning Pi session is resumed, the completion is replayed once.
- If a different Pi session is active, the result is not injected into that unrelated conversation.

## Notifying the managing agent

There are two useful notification levels.

### Passive agent context

Use `pi.sendMessage()` with `deliverAs: "nextTurn"`:

```ts
pi.sendMessage(
  {
    customType: "worker-completion",
    content: [
      {
        type: "text",
        text: `Worker ${job.id} completed. Use worker_get with jobId ${job.id} to inspect its result.`,
      },
    ],
    display: true,
    details: { jobId: job.id, status: job.status },
  },
  { deliverAs: "nextTurn" },
);
```

This does not interrupt the managing agent or automatically spend tokens. The completion becomes part of the next model turn, so when the user next speaks, the agent knows the worker is done.

This is the recommended default.

### Active continuation

For workflows explicitly requesting automatic continuation, send the completion as a follow-up and trigger another agent turn. Conceptually:

```ts
pi.sendMessage(completionMessage, {
  deliverAs: "followUp",
  triggerTurn: true,
});
```

This lets the managing agent immediately inspect the result and continue a workflow, but it can spend tokens unexpectedly and may interrupt the user's preferred control flow. It should therefore be opt-in per job or workflow.

The completion message should contain only a concise summary and job ID. The full transcript should stay in files or SQLite and be fetched with `worker_get`, avoiding context overflow.

## Notifying the user independently of the agent

The user notification path should not require an LLM turn.

### Pi notification

Call:

```ts
ctx.ui.notify(
  `Worker ${job.id} ${job.status}: ${shortTask}`,
  job.status === "completed" ? "info" : "error",
);
```

This displays immediately in the Pi TUI without adding model context or consuming tokens.

### Worker status widget

Use `ctx.ui.setWidget()` to show all jobs owned by the current Pi session:

```ts
ctx.ui.setWidget("worker-agent", [
  "Workers",
  "⏳ job_123  codex   Investigate flaky auth tests",
  "✓  job_456  cursor Plan caching refactor",
]);
```

The monitor rebuilds this widget whenever a job's status or latest progress changes. Suggested symbols:

```text
○ queued
◌ starting
⏳ running
✓ completed
✗ failed
■ cancelled
? orphaned
```

The widget is independent from the managing model:

- It is rendered directly by Pi's TUI.
- It consumes no model tokens.
- It can update while the managing agent is idle or streaming.
- It remains visible until jobs are acknowledged or removed.
- It should be cleared with `ctx.ui.setWidget("worker-agent", undefined)` during shutdown.

The widget can show a compact latest-progress line from the event registry, such as the current tool or phase, rather than streaming an entire transcript.

### Footer status

A compact footer can complement the widget:

```ts
ctx.ui.setStatus("worker-agent", "workers: 2 running, 1 done");
```

Use the widget for per-job details and the footer for aggregate status.

### Desktop notification

Pi's notification example uses terminal notification protocols on `agent_settled`. The same approach can be used for worker completion, or the detached runner can invoke an operating-system notifier or webhook.

Desktop notification from the runner is useful when Pi is closed, but it is not a replacement for durable delivery tracking. The database remains authoritative.

## Polling versus push notifications

### Polling SQLite

Recommended for the MVP:

- Minimal moving parts.
- Survives extension and process restarts.
- Easy to test.
- Approximately one-second notification latency.

### Local daemon with push events

A later version can run one long-lived Bun supervisor with:

- SQLite persistence.
- A Unix socket or localhost HTTP API.
- Server-sent events or WebSocket subscriptions.
- Centralized process cancellation and steering.

The Pi extension subscribes while active and falls back to querying SQLite after reconnecting. Push improves latency but does not eliminate the need for durable state.

## Coding isolation

Do not allow multiple coding workers to edit the same checkout concurrently.

- Planning and investigation workers may share the same cwd when restricted to read-only tools.
- Give each coding worker its own git worktree.
- Have the worker commit changes before completion.
- Record the commit SHA, base SHA, diff summary, and changed files.
- Let the managing agent or user inspect and cherry-pick the result.

Cursor's `--worktree` can provide isolation. For other harnesses, the runner can use `git worktree add`.

## Task data and artifact management

Treat a delegated task as a durable **task bundle**, not merely as a child process. Separate four concepts:

1. **Task** — the user-visible unit of work, such as “investigate flaky auth tests.”
2. **Worker session** — the resumable Cursor chat, Codex thread, or Pi session used for that task.
3. **Run** — one process invocation against that worker session. A follow-up or retry creates another run.
4. **Artifact** — a prompt, transcript, report, patch, commit, test log, screenshot, or other output.

A task can have several worker sessions, and each worker session can have several runs. This avoids overloading one job row with retries, parallel attempts, or follow-up prompts.

### Storage location

Use a global data directory by default so task history survives repository deletion and Pi session changes:

```text
~/.pi/agent/worker-agent/
├── registry.sqlite
├── tasks/
│   └── task_01J.../
└── worktrees/
```

Allow the root to be configured. Avoid storing large transcripts and generated artifacts directly in the project's `.pi` directory, where they could accidentally be committed.

SQLite is the searchable index and lifecycle authority. Files are the storage format for large or stream-oriented content. Do not put complete transcripts, patches, or binary artifacts in SQLite blobs.

### Task bundle layout

```text
tasks/task_01J.../
├── manifest.json
├── request.md
├── context.json
├── sessions/
│   └── session_01J.../
│       ├── session.json
│       └── runs/
│           ├── run_01J.../
│           │   ├── invocation.json
│           │   ├── prompt.md
│           │   ├── events.jsonl
│           │   ├── stderr.log
│           │   ├── final.md
│           │   ├── result.json
│           │   └── usage.json
│           └── run_01K.../
└── artifacts/
    ├── report.md
    ├── changes.patch
    ├── test-output.log
    └── artifact-manifest.json
```

`manifest.json` contains stable task metadata and lineage:

```json
{
  "schemaVersion": 1,
  "taskId": "task_01J...",
  "title": "Investigate flaky auth tests",
  "status": "running",
  "parentPiSessionId": "...",
  "parentPiSessionFile": "/.../session.jsonl",
  "projectCwd": "/path/to/repo",
  "baseGitSha": "abc123",
  "createdAt": "2026-04-01T12:00:00Z",
  "sessionIds": ["session_01J..."],
  "tags": ["investigation", "auth"]
}
```

Write manifests through a temporary file followed by an atomic rename. The database remains authoritative for current status; manifests make bundles portable and inspectable without SQLite.

### Worker session references

`session.json` records both the manager's ID and the harness-native identity:

```json
{
  "sessionId": "session_01J...",
  "taskId": "task_01J...",
  "harness": "codex",
  "nativeSessionId": "codex-thread-uuid",
  "nativeSessionFile": null,
  "model": "gpt-5.4",
  "cwd": "/path/to/worktree",
  "createdAt": "2026-04-01T12:00:03Z",
  "lastRunId": "run_01J..."
}
```

Harness-specific handling:

- **Cursor:** store the chat ID. The native conversation may be remote or managed by Cursor, so the chat ID is the resumable reference. Preserve the local normalized event transcript independently.
- **Codex:** store the thread ID and, when discoverable, its local rollout/session path. Resume by thread ID; do not depend solely on finding Codex's internal file layout.
- **Pi:** store both the Pi session ID and absolute JSONL session file. Pi's native JSONL is already a useful durable session artifact.

Do not copy or rewrite harness-owned session files while a worker is active. Record references to them. Optionally snapshot or export them after completion when the harness provides a supported export mechanism.

The normalized `events.jsonl` is owned by this system and gives a consistent audit trail even when native session formats differ or are unavailable.

### Run records

Each process invocation gets a new run ID. `invocation.json` should contain:

```json
{
  "runId": "run_01J...",
  "sessionId": "session_01J...",
  "kind": "initial",
  "command": ["codex", "exec", "--json", "..."],
  "cwd": "/path/to/worktree",
  "pid": 12345,
  "startedAt": "2026-04-01T12:00:05Z",
  "finishedAt": null,
  "exitCode": null
}
```

Redact API keys, authorization headers, secrets, and sensitive environment values before persisting command or environment data.

A follow-up creates another run with `kind: "followup"` and resumes the same worker session. A retry after infrastructure failure can use `kind: "retry"`. A fresh independent attempt should usually create a new worker session under the same task.

### Artifact registry

Store artifact metadata in both SQLite and `artifact-manifest.json`:

```text
id
task_id
session_id
run_id
kind
relative_path
media_type
size_bytes
sha256
created_at
producer
metadata_json
```

Useful artifact kinds include:

```text
prompt
normalized-transcript
native-session-export
final-response
report
plan
patch
git-commit
test-log
command-log
image
structured-result
```

Artifact paths stored in the database must be relative to the task bundle. Resolve and validate them against the bundle root to prevent path traversal.

When a worker reports a file as an artifact, the runner should copy it into the task bundle or register it as an explicitly external artifact. Prefer copying small reports and logs. For large files, store an external path plus checksum and mark it as non-portable.

### Coding results

For coding tasks, capture repository state independently of the worker's prose:

- Base commit SHA.
- Worktree path and branch.
- Final commit SHA, if committed.
- `git status --porcelain`.
- Changed-file list.
- Binary-safe patch or `git format-patch` output.
- Test commands and exit codes.
- A final summary from the worker.

The commit is the preferred integration artifact. The patch is a portable fallback. Do not treat the final assistant message as proof that changes were made or tests passed.

Worktrees are operational resources rather than permanent artifacts. Keep them while a task is active or awaiting review, then remove them after the commit and patch have been safely recorded.

### Database relationships

A more complete registry uses these tables:

```text
tasks
worker_sessions
runs
events
artifacts
deliveries
```

Relationships:

```text
task 1 ── N worker_sessions
worker_session 1 ── N runs
run 1 ── N events
run 1 ── N artifacts
task 1 ── N deliveries
```

The widget primarily reads `tasks`, `worker_sessions`, and the latest `runs`. `worker_get` joins those records and returns artifact summaries rather than embedding every artifact's content.

### Tool access to artifacts

Add focused APIs instead of returning entire bundles to the model:

- `worker_get({ taskId })` — status, sessions, latest progress, final summaries, artifact metadata.
- `worker_events({ runId, since, limit })` — paginated normalized events.
- `worker_artifact({ artifactId, offset, limit })` — bounded text reads or a path for binary content.
- `worker_followup({ sessionId, prompt })` — create another run in the native session.
- `worker_apply({ taskId, artifactId })` — apply a selected commit or patch after review.

All tool output should be truncated using Pi's normal 50 KB / 2,000-line limits. Return paths and artifact IDs for larger content.

### Retention and cleanup

Use explicit lifecycle policies:

- Keep active and unacknowledged tasks indefinitely.
- Keep task manifests, final responses, patches, commits, and session references longer than raw streaming events.
- Compress old JSONL and log files.
- Remove worktrees after integration, rejection, or expiry.
- Provide `worker_archive` and `worker_delete`; deletion should require confirmation.
- Never automatically delete the only copy of unmerged code changes.

A periodic reconciliation pass should detect:

- A `running` row whose PID no longer exists, marking it `orphaned` or `failed`.
- Missing artifact files.
- Worktrees left behind by crashed runs.
- Native session references that can no longer be resumed.
- Completed tasks whose notifications have not been delivered.

## Security defaults

- Use Cursor `--mode plan` or Codex `--sandbox read-only` for planning and investigation.
- Use isolated worktrees and workspace-write sandboxing for coding.
- Do not enable Cursor `--force` or Codex `--dangerously-bypass-approvals-and-sandbox` by default.
- Treat project-local worker prompts as untrusted unless the project is trusted.
- Restrict transcript and prompt files to user-readable permissions.

## Recommended MVP

1. Implement `worker_start`, `worker_list`, `worker_get`, and `worker_cancel`.
2. Add Cursor and Codex adapters using structured output.
3. Add the SQLite registry and per-job JSONL transcript.
4. Add a detached Bun runner that finalizes job state.
5. Add the Pi monitor, widget, footer status, and completion notification.
6. Add passive `nextTurn` completion messages for the managing agent.
7. Start with read-only planning and investigation jobs.
8. Add worktree-based coding, automatic continuation, and follow-ups afterward.
