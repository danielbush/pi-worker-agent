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

The project-local extension entry point is:

```text
.pi/extensions/worker-agent/index.ts
```
