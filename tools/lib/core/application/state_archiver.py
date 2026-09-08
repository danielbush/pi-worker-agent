"""APPLICATION: archive the oldest recorded runs out of one project's state.

The archive command is the single, manual mechanism for keeping a project's
`state.json` bounded: it keeps the most recently recorded runs and moves the
earlier surplus to the project's append-only `history.jsonl`, one complete
run object per line. `archive(document, to)` is pure: it returns a candidate
state document (surplus runs removed, `archived` incremented), the archived
run objects, and a human-readable summary -- it never writes anything. The
CLI appends the archived runs through the `Filesystem` append primitive
(history is never rewritten) and commits the candidate through
`StateStore.update` so validation and both generated task indexes run.

Run order is the recorded order in `state.json`: runs are stored oldest
first, so the surplus at the front of the list is archived and the trailing
`to` runs are kept. Archived runs keep that recorded order and are written
in full, exactly as they appear in state, preserving every field and unknown
extension. Nothing auto-runs: the manager invokes the command when it wants
to trim, and `StateStore` never archives on its own.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tools.lib.core.domain.project_state_validation import (
    ProjectStateValidationError,
    validate_project_state,
)
from tools.lib.core.infrastructure.filesystem import Filesystem


@dataclass(frozen=True)
class ArchiveOutcome:
    """Candidate state document, the archived runs, and summary lines."""

    candidate: dict[str, Any]
    archived_runs: list[dict[str, Any]]  # oldest first, in recorded order
    lines: list[str]


class StateArchiver:
    """INFRASTRUCTURE_CONSUMER: archive math plus the append-only history write.

    `archive` never writes. The CLI composes the full command: print
    `outcome.lines`, append `outcome.archived_runs` to history via
    `append_history`, then commit the candidate through `StateStore.update`.
    """

    def __init__(self, project_dir: Path, filesystem: Filesystem) -> None:
        self.project_dir = project_dir
        self.filesystem = filesystem

    @classmethod
    def create(cls, project_dir: Path) -> StateArchiver:
        return cls(project_dir, Filesystem.create())

    @classmethod
    def create_null(
        cls,
        project_dir: Path,
        *,
        files: dict[str, str] | None = None,
        directories: Iterable[str] | None = None,
    ) -> StateArchiver:
        return cls(
            project_dir,
            Filesystem.create_null(files=files, directories=directories),
        )

    def history_path(self) -> Path:
        return self.project_dir / "history.jsonl"

    def archive(self, document: Mapping[str, Any], *, to: int) -> ArchiveOutcome:
        """Return the trimmed candidate plus the archived runs; never writes."""
        if to < 0:
            raise ArchiveError(f"--to must be >= 0, got {to}")
        original = copy.deepcopy(dict(document))
        project = self._project_name(original)
        runs = original.get("runs")
        if not isinstance(runs, list):
            raise ArchiveError("state document has no runs list")
        if len(runs) <= to:
            candidate = copy.deepcopy(dict(original))
            lines = [
                (
                    f"{project}: {len(runs)} runs, nothing to archive "
                    f"(keeping at most {to})"
                )
            ]
            return ArchiveOutcome(
                candidate=candidate, archived_runs=[], lines=lines
            )
        surplus = copy.deepcopy(runs[: len(runs) - to])
        keep = copy.deepcopy(runs[len(runs) - to :])
        candidate = copy.deepcopy(dict(original))
        candidate["runs"] = keep
        previous = original.get("archived")
        if type(previous) is not int or previous < 0:
            previous = 0
        candidate["archived"] = previous + len(surplus)
        try:
            validate_project_state(candidate, project, baseline=original)
        except ProjectStateValidationError as error:
            raise ArchiveError(str(error)) from error
        lines = [
            (
                f"{project}: {len(runs)} runs, archive {len(surplus)} "
                f"(keep the most recent {to})"
            )
        ]
        lines.extend(f"  archive {run.get('run_id') or '?'}" for run in surplus)
        return ArchiveOutcome(
            candidate=candidate, archived_runs=surplus, lines=lines
        )

    def append_history(self, runs: Iterable[Mapping[str, Any]]) -> None:
        """Append one complete JSON run object per line; never rewrites."""
        text = "".join(
            json.dumps(run, ensure_ascii=False, allow_nan=False) + "\n"
            for run in runs
        )
        if text:
            self.filesystem.append_text(self.history_path(), text)

    def _project_name(self, document: Mapping[str, Any]) -> str:
        project = document.get("project")
        if isinstance(project, str) and project:
            return project
        return self.project_dir.name


class ArchiveError(ValueError):
    """An archive candidate is unusable; nothing was written."""

