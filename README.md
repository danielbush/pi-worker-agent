# pi-worker-agent

A local [Pi](https://github.com/badlogic/pi-mono) extension that lets one manager agent organise and supervise coding agents.

This is experimental and has barely been tested beyond the author's hot little hands. Expect rough edges.

## Why?

The user talks to one manager agent in Pi. That manager can organise workers across different models and harnesses—for example, Sol 5.6 workers through the Pi harness and Grok workers through the Cursor harness.

Every piece of work is represented as a durable **task** containing one or more **jobs**. Jobs can be sequenced into workflows such as:

```text
plan → implement → review
```

The runner does not hardcode what higher-level work means. Project management—the stories, epics, priorities, review rules, and acceptance process—is deliberately controlled by editable policy documents. The author's policy favours small **Vertical slices**, real user-observed Demos, and a tight OODA loop so agent work stays grounded in outcomes.

See [`examples/`](examples/) for the policy documents used by the author.

## Try it locally

You need Pi and Bun installed. Clone the repository, install dependencies, and launch Pi from inside it:

```bash
git clone https://github.com/danielbush/pi-worker-agent.git
cd pi-worker-agent
bun install
pi
```

Pi loads the local extension from:

```text
.pi/extensions/worker-agent/index.ts
```

The manager starts with restricted tools. Use `/development-mode` only when you intentionally want to let it modify this codebase directly; `/manager-mode` returns to restricted manager tools.

## Data and policy

Worker-agent state defaults to the repository's gitignored `work/` directory. That is convenient for trying it, but for ongoing use you may want the data outside the clone so it can be organised, backed up, and retained independently:

```dotenv
DATA_ROOT=/path/to/worker-agent-data
```

A worker-agent-specific override takes precedence:

```dotenv
PI_WORKER_AGENT_DATA_ROOT=/path/to/worker-agent-data
```

The data root holds the SQLite registry, durable task/job files, project-management files, and policy documents:

- `PROJECT.md` — how higher-level projects and work are organised.
- `WORKFLOW.md` — how jobs are sequenced, reviewed, revised, and accepted.
- `CODE.md` — coding, architecture, testing, and safety conventions.

Copy and adapt the examples rather than treating the author's preferences as hardcoded product behavior.

## Safety warning

Sandboxing remains an ongoing issue.

- The Pi manager starts in application-restricted manager mode.
- Pi workers run through OS sandboxing provided by `@anthropic-ai/sandbox-runtime`.
- Cursor workers currently cannot use the same sandbox reliably because the Cursor SDK stream stalls behind its HTTP proxy. They therefore run with an explicit `NullSandbox` as trusted same-user processes.

A Cursor worker still gets an isolated Git worktree and minimal environment, but its shell is **not** confined by an OS sandbox. Be careful about which repositories, credentials, prompts, and job capabilities you give it. See [`ISSUES.md`](ISSUES.md) for the current limitation.

## Development checks

```bash
bun run test
bun run typecheck
```

See [`DIAGNOSTICS.md`](DIAGNOSTICS.md) for focused readiness checks. It defaults to quick, non-live checks rather than launching models unnecessarily.

For implementation details, see:

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`DESIGN.md`](DESIGN.md)
- [`DIAGNOSTICS.md`](DIAGNOSTICS.md)
- [`ISSUES.md`](ISSUES.md)

## Inspiration

Inspired by Kun Chen's [firstmate](https://github.com/kunchenguid/firstmate)—check it out, along with [Kun Chen's posts and videos](https://x.com/kunchenguid). This project is an attempt to roll a smaller, policy-driven version using Pi and Bun.
