# pi-worker-agent

A prototype Pi extension for durable detached worker tasks.

The first vertical slice intentionally uses a model-free demo worker. It validates:

- Returning immediately from a worker launch.
- A detached process updating durable SQLite state.
- Per-task request, event, and result artifacts.
- A Pi widget that polls worker state without using model tokens.
- User notifications and passive managing-agent completion messages.
- Replaying undelivered completions after a Pi session resumes.

See [`DESIGN.md`](DESIGN.md) for the complete Cursor/Codex/Pi design.

## Install and test

```bash
bun install
bun test
bun run typecheck
```

## Try it in Pi

The extension is project-local at:

```text
.pi/extensions/worker-agent/index.ts
```

Trust this project and reload Pi:

```text
/trust
```

Restart Pi after saving trust, or start it from this directory with:

```bash
pi --approve
```

Then launch a demo worker directly, without an LLM call:

```text
/worker-demo investigate the auth tests
```

For about three seconds the widget should progress through:

```text
Workers — 1 active, 0 finished
⏳ job_... reading task
⏳ job_... doing detached work
⏳ job_... writing result
```

It then becomes completed and Pi displays a notification. A passive completion message is queued for the managing agent's next turn.

The model can also use:

- `worker_start`
- `worker_list`
- `worker_get`

## Data

By default, durable data is stored under:

```text
~/.pi/agent/worker-agent/
├── registry.sqlite
└── tasks/job_<uuid>/
    ├── manifest.json
    ├── request.md
    ├── events.jsonl
    └── final.md
```

Override the location for testing:

```bash
PI_WORKER_AGENT_DIR=/tmp/pi-workers pi --approve
```

Inspect current-session jobs from a shell launched by Pi:

```bash
bun run workers
```

## Next slice

After evaluating the lifecycle and UI, replace the demo implementation in `src/runner.ts` with one real structured-output adapter, preferably Codex read-only mode. The registry, task bundle, monitoring, and notification paths remain unchanged.
