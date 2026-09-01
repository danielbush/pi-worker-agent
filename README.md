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

The manager creates each job explicitly and stops after code so the user can exercise the result in its isolated worktree. This is a normal policy-driven task, not a `/worker-demo` command. A subsequent vertical slice will extend the flow with review.

Inspect any created task from Pi with:

```text
/worker-status <task-uuid>
```
