"""Archive the oldest recorded runs out of one project's state.json (dry-run by default).

The archive command is the manual mechanism for keeping a project's
`state.json` bounded. `--to N` (default 20) keeps the N most recently
recorded runs in `projects/<project>/state.json` and archives the older
surplus to the project's append-only `history.jsonl`, one complete run object
per line. Without `--write` the tool prints what would be archived and writes
nothing. With `--write` it appends the archived runs to `history.jsonl` and
commits the trimmed state through `StateStore.update`, so the project
`state.json`, the project `TASKS.md`, and the repository-root `TASKS.md` are
regenerated in one validated commit. Nothing auto-runs; the manager invokes
the command when it wants to trim.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from tools.lib.core.application.state_archiver import ArchiveError, StateArchiver
from tools.lib.core.application.state_store import (
    StateStore,
    StateStoreCommitError,
    StateStoreLoadError,
)
from tools.lib.core.domain.project_state_validation import (
    ProjectStateValidationError,
)


def _build_parser() -> argparse.ArgumentParser:
    """CLI flags for project, keep-count, and the dry-run/write split."""
    parser = argparse.ArgumentParser(
        description=(
            "Archive the oldest recorded runs out of one project's state.json "
            "into its append-only history.jsonl. Dry-run by default; --write "
            "appends history and commits through StateStore."
        )
    )
    parser.add_argument(
        "--project",
        required=True,
        help="Project name under projects/ whose state should be trimmed.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root (default: current working directory).",
    )
    parser.add_argument(
        "--to",
        type=int,
        default=20,
        help="Keep the most recent N runs in state.json (default: 20).",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Append archived runs to history.jsonl and commit the trimmed state.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Composition root: summarize, append history, and commit one archive."""
    args = _build_parser().parse_args(argv)
    repo_root = (args.repo_root or Path.cwd()).resolve()
    project_dir = repo_root / "projects" / args.project
    if not project_dir.is_dir():
        print(
            f"error: no project directory at {project_dir}",
            file=sys.stderr,
        )
        return 1
    if args.to < 0:
        print(f"error: --to must be >= 0, got {args.to}", file=sys.stderr)
        return 1
    try:
        store = StateStore.load(project_dir)
    except StateStoreLoadError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    archiver = StateArchiver.create(project_dir)
    try:
        outcome = archiver.archive(store.snapshot(), to=args.to)
    except ArchiveError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for line in outcome.lines:
        print(line)
    if not args.write:
        print("dry run: nothing written")
        return 0
    if not outcome.archived_runs:
        print("nothing to archive; nothing written")
        return 0
    history_path = archiver.history_path()
    try:
        archiver.append_history(outcome.archived_runs)
    except OSError as error:
        print(
            f"error: history append failed for {history_path}: {error}",
            file=sys.stderr,
        )
        return 1
    try:
        store.update(lambda _document: outcome.candidate)
    except (ProjectStateValidationError, StateStoreCommitError) as error:
        print(f"error: {error}", file=sys.stderr)
        print(
            f"note: history append already succeeded for {history_path}; "
            "reconcile state vs history before retrying",
            file=sys.stderr,
        )
        return 1
    print(
        f"wrote {store.state_path()}, {project_dir / 'TASKS.md'}, "
        f"{repo_root / 'TASKS.md'}; appended {len(outcome.archived_runs)} "
        f"run(s) to {history_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
