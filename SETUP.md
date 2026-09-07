# Setup — this machine

Local setup for developing and running this manager repository. Not user
policy; see `policies/` for that.

## Tooling

- **mise** manages tool versions (`mise.toml`: uv, go-task). Run `mise install` after clone or changes.
- **go-task** wraps common commands (`taskfile.yml`): `task start` runs the manager, `task test` runs pytest + ty + ruff.
- **uv** manages Python and dependencies: `pyproject.toml`, `uv.lock`,
  `.python-version` (3.13).

## Rules

- Add dependencies with `uv add` (runtime) or `uv add --dev` (dev/test tools
  such as pytest). Never edit `pyproject.toml` dependency lists by hand, and
  never use pip.
- Run Python through uv: `uv run python ...`, `uv run pytest`. Do not rely on
  a system or ad-hoc interpreter.
- pytest is the official test runner for `tools/` and `tests/`.
- Prime Agent is installed globally (`npm i -g prime-agent`); run it from the
  repository root.
