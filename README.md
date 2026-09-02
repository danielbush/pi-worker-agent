# pi-worker-agent

A work-in-progress Pi extension for managing durable tasks and detached worker agents from Pi.

Development is driven through the managed `pi-worker-agent` project under the configured data root. The current target is manager-orchestrated `plan → code` work against this repository, without a hardcoded demo command.

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

`WORKFLOW.md` defines a policy-level **Demo task** flow for exercising real task handling and manager orchestration against the current project:

```text
plan → code (`implement` job)
```

The manager uses narrow orchestration tools to register workspaces and management projects, create and associate tasks, query project task status, and delegate jobs explicitly. Manager mode exposes only read and orchestration tools; arbitrary shell commands and file mutations are blocked. The manager may inspect and propose any workspace path, but registration or directory creation requires interactive user approval. SQLite records approved canonical workspace paths, maps `$DATA_ROOT/projects/<directoryName>` entries to durable project metadata, and associates tasks through `projects_tasks`; Markdown `taskid://...` links remain human-facing references. Projects, workspaces, and tasks use bare UUIDs, and manager tools accept unique leading shorthand of at least four characters.

When directly developing this system, the user can run `/development-mode` and confirm the warning to restore unrestricted coding tools for the current session. `/manager-mode` immediately restores the restricted tool set, and every new or reloaded session starts restricted.

Quickly test the boundary with the harmless prompt `Use bash to run pwd. Do not use another tool.` It should be unavailable or blocked after startup and after `/manager-mode`, succeed after confirmed `/development-mode`, then become unavailable again after `/manager-mode`.

Planning workers are read-only; implementation workers receive an isolated worktree plus write, edit, and shell tools. Every Pi worker process tree runs through `@anthropic-ai/sandbox-runtime`: macOS uses `sandbox-exec`, Linux uses Bubblewrap, and unsupported platforms—including Windows—fail closed. Writes are limited to the implementation worktree, canonical worker-session directory, and its private temporary directory; common model-provider domains are allowlisted and sensitive credential directories are denied to worker reads. Linux hosts must provide `bubblewrap`, `socat`, and `ripgrep`.

The demo stops after code so the user can exercise the result. This is a normal policy-driven task, not a `/worker-demo` command. A subsequent vertical slice will extend the flow with review.

Inspect any created task from Pi with:

```text
/task-status <task-uuid>
```
