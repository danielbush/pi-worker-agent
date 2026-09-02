# pi-worker-agent

A work-in-progress Pi extension for managing durable tasks and detached worker agents from Pi.

Development is driven through the managed `pi-worker-agent` project under the configured data root. The current target is manager-orchestrated `plan → implement → review` work through named Pi or Cursor Agent profiles, without a hardcoded demo command.

See:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — target data and source architecture.
- [`DESIGN.md`](DESIGN.md) — current outcomes, intent, and implementation plan.
- [`examples/`](examples/) — default policy files for project management, workflow, and coding.

## Install and test

```bash
bun install
bun test
bun run typecheck
```

Worker-agent data defaults to the project-local, gitignored `work/` directory.
Consumers normally copy the example policies into their data root and customize
them, or create their own. This maintainer checkout symlinks its `work/` policy
files to `examples/` only so the examples can be maintained and used in place;
the symlinks are not part of normal usage. Consumers can choose another data
root by setting `DATA_ROOT`, or set `PI_WORKER_AGENT_DATA_ROOT` when they need
the worker-agent-specific variable to take precedence.

```dotenv
DATA_ROOT=/path/to/worker-agent-data
# or, with precedence over DATA_ROOT:
PI_WORKER_AGENT_DATA_ROOT=/path/to/worker-agent-data
```

List managed projects with the same data-root resolution used by the extension:

```bash
bun run projects
```

The project-local extension entry point is:

```text
.pi/extensions/worker-agent/index.ts
```

## Managed-project development

The current project sequence and vertical-slice walkthrough are stored under:

```text
$DATA_ROOT/projects/pi-worker-agent/
```

`WORKFLOW.md` defines the coding flow the manager applies. Planning and review are defaults, with explicit per-task omissions available:

```text
plan → implement → review
```

The manager uses narrow orchestration tools to register workspaces and management projects, create and associate tasks, query project task status, and delegate jobs explicitly. Manager mode exposes only read and orchestration tools; arbitrary shell commands and file mutations are blocked. The manager may inspect and propose any workspace path, but registration or directory creation requires interactive user approval. SQLite records approved canonical workspace paths, maps `$DATA_ROOT/projects/<directoryName>` entries to durable project metadata, and associates tasks through `projects_tasks`; Markdown `taskid://...` links remain human-facing references. Projects, workspaces, and tasks use bare UUIDs, and manager tools accept unique leading shorthand of at least four characters.

When directly developing this system, the user can run `/development-mode` and confirm the warning to restore unrestricted coding tools for the current session. `/manager-mode` immediately restores the restricted tool set, and every new or reloaded session starts restricted.

Quickly test the boundary with the harmless prompt `Use bash to run pwd. Do not use another tool.` It should be unavailable or blocked after startup and after `/manager-mode`, succeed after confirmed `/development-mode`, then become unavailable again after `/manager-mode`.

The manager compiles `$DATA_ROOT/WORKFLOW.md` (default `work/WORKFLOW.md`). We ship the template as `examples/WORKFLOW.md`; consumers copy it into the data root. That file contains exactly one strictly parsed fenced YAML profile configuration. The example defaults use `pi-sol-high` for planning, implementation, and fixes, and `pi-sol-medium` for review/tests. Additional harness profiles may be configured as overrides; if a selected harness cannot start, stop and continue on a working profile. `worker_create_task` accepts optional purpose-to-profile overrides; these select only harness-native model options and cannot grant capabilities. Delegation verifies one resolved executable identity, version/help contract, authentication, model catalog, native options, sandbox, Bun, and runner before creating execution state.

Cursor Agent `2026.08.25-3e8eec8` was inspected at `/Users/danb/.local/bin/cursor-agent`. Its installed help confirms `--print --output-format stream-json`, `--stream-partial-output`, `--model`, `--list-models`, private API-key auth, and endpoint `https://api2.cursor.sh`; installed resources also name `api2direct.cursor.sh` and metrics host `api3.cursor.sh`. In this job's network boundary, the configured local HTTP CONNECT proxy returned `403 X-Proxy-Error: blocked-by-allowlist` for `api2.cursor.sh`. The authenticated CLI `status` said `Login successful` but could not fetch user details; `--list-models` and a minimal stream-JSON run both failed before TLS with `Client network socket disconnected before secure TLS connection was established`, and the run emitted zero stdout bytes. That redacted TLS failure is retained as a fixture; it contained no credentials. A later unsandboxed capture of `--print --output-format stream-json` succeeded for the same CLI version; production allowlists `2026.08.25-3e8eec8`. Other versions fail closed. Default example workflow jobs still use Pi.

Planning and review workers are read-only; implementation workers receive an isolated worktree plus write, edit, and shell tools. Reviews inherit the implementation worktree through their dependency and inspect it without write access. Every Pi or Cursor Agent worker process tree runs through `@anthropic-ai/sandbox-runtime`: macOS uses `sandbox-exec`, Linux uses Bubblewrap, and unsupported platforms—including Windows—fail closed. Writes are limited to the implementation worktree, canonical worker-session directory, and a non-canonical private OS temporary directory; common model-provider domains are allowlisted and sensitive credential directories are denied to worker reads. Pi credentials are staged after preflight under a disposable private `HOME` and removed on every settlement path. Cursor workers use the host `cursor-agent login` keychain (they must keep the login `HOME`) or narrowly selected `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN` values; CLI scratch goes to a private `CURSOR_DATA_DIR`. They cannot read the manager's persistent Cursor/Pi files. There is no `~/.cursor/auth.json` copy — that Pi pattern does not apply. Linux hosts must provide `bubblewrap`, `socat`, and `ripgrep`.

Settled worker results trigger a new manager turn. The manager re-reads policy, evaluates the result, and performs the next required transition; the runner itself never invents successor jobs. After accepting the task outcome, the manager uses a narrow completion tool to settle the task. The tool rejects tasks with active work but does not encode workflow semantics or interpret settled job results.

Verbose status includes the immutable profile fingerprint, trusted capability, harness version, and native invocation snapshot. Inspect any created task from Pi with:

```text
/task-status <task-uuid>
```
