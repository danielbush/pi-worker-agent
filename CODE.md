# Coding — prime-worker-agent

Project-specific coding standards for this repository. These extend and
override the manager's global `policies/CODE.md`. `task.md` constraints win
over both.

## Python

The global Python rules (uv, ruff, ty, pytest, snake_case) apply. Project
additions:

- `tools/` layout follows the three-way classification: `tools/lib/domain/`
  (domain nouns), `tools/lib/infrastructure/` (filesystem wrapper + drivers),
  application modules at `tools/lib/` top level until a second one appears
  (then create `tools/lib/application/` and move application constructs
  there together). CLI entry stays at `tools/` top level.
- `tests/` mirrors the `tools/` layout.

## Tooling

- Tool versions via **mise** (`mise.toml`); see `SETUP.md`.
- Verification commands for coding jobs in this repo:
  `uv run pytest`, `uv run ty check`, `uv run ruff check`.
