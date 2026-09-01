# pi-worker-agent

A work-in-progress Pi extension for delegating durable tasks to detached worker agents.

The first target is a hardcoded `/worker-demo` workflow with Pi as both manager and worker. It will create one task containing planning, implementation, and review jobs.

See:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — target data and source architecture.
- [`DESIGN.md`](DESIGN.md) — current outcomes, intent, and implementation plan.

## Install and test

```bash
bun install
bun test
bun run typecheck
```

Worker-agent data defaults to `~/.pi/agent/worker-agent`. Override it with
`PI_WORKER_AGENT_DATA_ROOT` in the environment or a Bun-loaded `.env` file when
needed. `DATA_ROOT` is also accepted as a convenience fallback.

```dotenv
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
/worker-status task_<id>
```
