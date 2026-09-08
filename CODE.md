# Coding — prime-worker-agent

Project-specific coding standards for this repository. These extend and
override the manager's global `policies/CODE.md`. `task.md` constraints win
over both.

## Python

The global Python rules (uv, ruff, ty, pytest, snake_case) apply. Project
additions:

- `tools/lib/` is a container for subsystem packages, one directory per
  subsystem: `tools/lib/core/` (run/task state and index rendering) and
  `tools/lib/show_managed_file/` (managed-file resolution and editor launch
  for the `show-managed-file` skill).
- Each subsystem package follows the three-way classification:
  `<subsystem>/domain/` (domain nouns), `<subsystem>/application/`
  (orchestration, e.g. `tools/lib/core/application/state_store.py`), and
  `<subsystem>/infrastructure/` (filesystem wrapper + drivers).
- CLI entry stays outside the library: `tools/` top level for repository
  tools, and `.agents/skills/show-managed-file/scripts/show_managed_file.py`
  for the managed-file skill.
- `tests/` mirrors the `tools/` layout, so subsystem tests live under
  `tests/lib/core/` and `tests/lib/show_managed_file/`.

## Tooling

- Tool versions via **mise** (`mise.toml`); see `SETUP.md`.
- Verification commands for coding jobs in this repo:
  `uv run pytest`, `uv run ty check`, `uv run ruff check`.
