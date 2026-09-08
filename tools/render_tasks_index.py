"""Generate the repository-root TASKS.md from projects/*/state.json."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from tools.lib.core.application.tasks_index_writer import TasksIndexWriter


def _build_parser() -> argparse.ArgumentParser:
    """CLI flags for repo root and read-only `--check`."""
    parser = argparse.ArgumentParser(
        description="Render the repository-root TASKS.md from project state files."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root (default: current working directory).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if TASKS.md is missing or out of date; do not write.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Composition root: check or write the repository-root TASKS.md."""
    args = _build_parser().parse_args(argv)
    repo_root = (args.repo_root or Path.cwd()).resolve()
    writer = TasksIndexWriter.create(repo_root)
    if args.check:
        if writer.is_current():
            return 0
        print("TASKS.md is missing or out of date.", file=sys.stderr)
        return 1
    writer.write()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
