# pi-worker-agent

A work-in-progress Pi extension for delegating durable tasks to detached worker agents.

The first target is a hardcoded `/worker-demo` workflow with Pi as both manager and worker. It will create one task containing planning, implementation, and review jobs.

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

## Try the current vertical slice

From Pi in this repository:

```text
/reload
/worker-demo
/worker-status
```

`/worker-demo` starts a detached Pi planning worker and reports its task ID. Run
`/worker-status` again to watch the planning job move through `queued`, `running`,
and `completed`. The status includes the canonical request and event-log paths and
the worker's final response. After a reload, pass the reported ID explicitly:

```text
/worker-status <task-uuid>
```
