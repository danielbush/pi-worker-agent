"""Rebuild one project's state.json from its on-disk tasks tree (dry-run by default).

Without `--write` the tool scans `projects/<project>/tasks/`, prints a
per-run change summary, and writes nothing. With `--write` it commits the
rebuilt document through `StateStore.update`, so the project `state.json`,
the project `TASKS.md`, and the repository-root `TASKS.md` are regenerated in
one validated commit.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from tools.lib.core.application.project_state_rebuilder import (
    ProjectStateRebuilder,
)
from tools.lib.core.application.state_store import (
    StateStore,
    StateStoreCommitError,
    StateStoreLoadError,
)
from tools.lib.core.domain.project_state_validation import (
    ProjectStateValidationError,
)


def _build_parser() -> argparse.ArgumentParser:
    """CLI flags for the project to rebuild and the dry-run/write split."""
    parser = argparse.ArgumentParser(
        description=(
            "Rebuild one project's state.json from its on-disk tasks/ tree. "
            "Dry-run by default; --write commits through StateStore."
        )
    )
    parser.add_argument(
        "--project",
        required=True,
        help="Project name under projects/ whose state should be rebuilt.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root (default: current working directory).",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Commit the rebuilt state (and both generated TASKS.md files).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Composition root: scan, summarize, and optionally commit one rebuild."""
    args = _build_parser().parse_args(argv)
    repo_root = (args.repo_root or Path.cwd()).resolve()
    project_dir = repo_root / "projects" / args.project
    if not project_dir.is_dir():
        print(
            f"error: no project directory at {project_dir}",
            file=sys.stderr,
        )
        return 1
    try:
        store = StateStore.load(project_dir)
    except StateStoreLoadError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    rebuilder = ProjectStateRebuilder.create(project_dir)
    try:
        outcome = rebuilder.rebuild(store.snapshot())
    except ProjectStateValidationError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for line in outcome.lines:
        print(line)
    if not args.write:
        print("dry run: nothing written")
        return 0
    try:
        store.update(lambda _document: outcome.candidate)
    except (ProjectStateValidationError, StateStoreCommitError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(
        f"wrote {store.state_path()}, {project_dir / 'TASKS.md'}, "
        f"{repo_root / 'TASKS.md'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
