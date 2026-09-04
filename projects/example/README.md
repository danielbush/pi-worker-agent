# example

A worked example of manager-owned project context. Copy this directory, rename
it, and replace the contents. Only the manager edits this file. Workers receive
only the parts relevant to their job, not the whole file.

---

## Workspace

Default workspace: `/Users/you/code/example-api`

The workspace is separate from this manager control record. It may be a
standalone directory, main Git checkout, or worktree. The manager selects the
exact workspace for each run, records it in `state.json`, and tells workers to
`os.chdir` there. Record checkout type and stable constraints here; inspect
mutable facts such as the current branch and status at run time. Never redirect
a worker from a selected worktree to the main checkout.

## Control-record ownership

Only the manager edits `README.md`, `state.json`, `history.jsonl`, and run
metadata under `projects/<name>/`. The manager creates each run directory. A
worker may write only its assigned `runs/<run-id>/<job>.md` result file.

## What it is

A small TypeScript HTTP API. Fastify, Postgres via Drizzle, deployed to Fly.

## Project commands

Read-only file inspection, text search, `git status`, and `git diff` are allowed.
Each worker brief must explicitly name which other commands it may run.

Available commands for the manager to authorize:

- Install: `pnpm install`
- Test: `pnpm test`
- Typecheck and lint: `pnpm check`
- Dev server: `pnpm dev` (needs a local Postgres on 5432)
- Generate migrations: `pnpm db:generate`

Use `pnpm check` to verify an implementation job when that command is included
in its brief. Dependency changes, migrations, deployments, service commands,
and Git-mutating commands require explicit approval.

## Conventions

- Never commit to `main`. Branch as `agent/<short-description>`.
- Migrations are generated, not hand-written: `pnpm db:generate`.
- Route handlers stay thin. Business logic lives in `src/services/`.
- Tests sit next to the code as `*.test.ts`.

## Don't touch

- `src/db/migrations/` — generated, and already applied in production.
- `infra/` — Terraform, deployed by hand.
- Anything under `vendor/`.

## Current focus

Splitting the monolithic `src/services/billing.ts` into per-concern modules.
There's a plan at `runs/2026-08-30-1100-investigate/investigate.md`.

## Manager-only notes

The test suite needs Postgres running. If tests fail with a connection error,
workers should report the environment problem instead of trying to repair it.

`pnpm check` takes about three minutes. Do not assume it hung.

Use these notes to build a minimal worker brief. Do not send unrelated project
history or constraints to every worker.
