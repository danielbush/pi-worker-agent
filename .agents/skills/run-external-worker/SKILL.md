---
name: run-external-worker
description: Launch, monitor, recover, cancel, and finalize any Prime Worker Agent job whose resolved harness is not `rlm`, including `cursor-agent`. Use this skill before preparing or launching every external worker and whenever an external process stalls, loses its handle, needs resumption, or finishes. Enforces durable JSONL logs, numbered reports, nonblocking process handles, internal heartbeats, session capture, and manager verification.
compatibility: Requires the Python `bash()` process API, `rlm-heartbeat`, manager-owned project control records, and the selected external harness CLI.
---

# Run an external worker

Use this procedure only after a job resolves to a harness other than `rlm`.
External processes are not Prime Agent children: they have no agent messaging,
agent observation, family roster, or completion notification.

All normal manager rules still apply: exact workspace, minimal brief, explicit
command authorization, protected paths, globally numbered report, and manager-
owned state.

## 1. Prepare durable records

Before launch:

1. Verify the exact absolute workspace. If it is Git-backed, verify both
   `git rev-parse --show-toplevel` and `git rev-parse --git-common-dir`; never
   replace a selected worktree with its main checkout or common directory.
2. Create manager-owned `runs/<run-id>/reports/` and `logs/` directories.
3. Reserve exactly one `reports/<NN>-<job>.md`. The sequence number is global
   within the run and reflects execution order; retries get a new number.
4. Choose `logs/<NN>-<job>.<harness>.jsonl` for the raw event stream.
5. Record the job's actual harness, exact model, route when applicable,
   `harness_log`, assigned report, start time, and `running` status in
   `state.json`; regenerate task indexes.

## 2. Build the worker brief

The prompt must contain only job-relevant data:

- objective and acceptance criteria;
- exact absolute workspace and an instruction to change into it first;
- manager-owned `task.md` and required earlier report paths;
- assigned report path;
- explicit allowed install, dependency, generation, build, test, typecheck,
  migration, deployment, service, and Git-mutating commands; and
- protected paths and prohibited actions.

Never include credentials. The workspace is the only project-write location;
the assigned report is the sole control-record exception.

## 3. Launch without blocking

Use the Python `bash()` API and retain its returned handle in a named kernel
variable. Do not use blocking subprocess calls or a long `await`.

For Cursor Agent:

- verify authentication with `cursor-agent status`;
- use the exact ID from `cursor-agent models`;
- run from the exact workspace;
- use `--print --output-format stream-json`;
- direct the stream to the durable JSONL log;
- use sandboxing when supported; and
- use `--force` only when the brief contains an explicit command allowlist and
  protected paths.

If output is piped through `tee`, enable shell `pipefail` so the captured exit
status belongs to the harness rather than `tee`.

## 4. Start the required heartbeat

Immediately create an internal RLM heartbeat and record its ID in active job
state. Use:

- a label containing project, run ID, and job;
- a two-minute interval by default; and
- `delivery_mode="follow_up"`.

The instruction must name the process handle variable when available, state
path, durable log, assigned report, and completion checks. Each tick must poll
without blocking and read only the log tail. Report only a new milestone,
blocker, stall, or completion; never repeat unchanged status.

A heartbeat is an ephemeral scheduler, not durable recovery state.

## 5. Monitor

- Use `handle.running` and `handle.poll()` without blocking.
- Read only a bounded tail of the durable JSONL log; never print the entire raw
  stream into model context.
- Extract and record the harness session or chat ID when it appears so a later
  manager can resume safely.
- Keep the user informed at meaningful milestones.
- Do not launch a duplicate merely because the external process is quiet.

## 6. Finalize

A zero process exit is not sufficient. Completion requires:

1. terminal process status and recorded exit code;
2. a usable assigned report;
3. manager inspection of the workspace and changed paths;
4. authorized verification commands passing; and
5. updated state and regenerated indexes.

Delete the heartbeat and remove its ID from active state after terminal
verification. Pass the written report—not the raw harness log—to the next job.
Raw logs are audit and recovery records and may contain verbose model output.

## 7. Recover or cancel

If the Python handle is lost, treat a saved PID only as a hint because PIDs can
be reused. Inspect the durable log and captured harness session ID. If liveness
cannot be proved, mark the job blocked instead of launching a duplicate. Resume
through the harness only when safe; otherwise allocate a new numbered attempt.

To cancel a live retained process, call `handle.kill()`, record its terminal
status and exit, preserve the log, remove its heartbeat, and update state and
indexes. Never reuse its assigned report number.
