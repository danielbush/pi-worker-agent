# example

A worked example. Copy this directory, rename it, and replace the contents.

Everything below is what the manager reads before spawning any worker, so write
it for an agent that has never seen the codebase.

---

## Path

`/Users/you/code/example-api`

Absolute. Workers `os.chdir` here before doing anything.

## What it is

A small TypeScript HTTP API. Fastify, Postgres via Drizzle, deployed to Fly.

## Commands

- Install: `pnpm install`
- Test: `pnpm test`
- Typecheck and lint: `pnpm check`
- Dev server: `pnpm dev` (needs a local Postgres on 5432)

Use `pnpm check` as the autonomous gate for implement stages. It runs typecheck,
lint, and tests.

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

## Notes for workers

The test suite needs Postgres running. If tests fail with a connection error,
that's the environment, not the change — say so rather than trying to fix it.

`pnpm check` takes about three minutes. Don't assume it hung.
