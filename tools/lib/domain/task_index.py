"""Active/recent split of project runs, with ordering and the recent cap."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from tools.lib.domain.project_state import ProjectState
from tools.lib.domain.run_record import RunRecord

ACTIVE_STATUSES = frozenset(
    {"awaiting-approval", "queued", "running", "awaiting-user-review", "blocked"}
)
RECENT_LIMIT = 20


def _parse_created(created: str | None) -> datetime:
    """Parse a run `created` stamp, treating missing or invalid values as UTC datetime.min."""
    if not created:
        return datetime.min.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(created)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


@dataclass(frozen=True)
class TaskIndex:
    """Domain model that splits runs into active vs recent and caps the recent list."""

    active: tuple[RunRecord, ...]
    recent: tuple[RunRecord, ...]

    @classmethod
    def from_runs(cls, runs: list[RunRecord]) -> TaskIndex:
        """Sort active oldest-first and recent newest-first, keeping only RECENT_LIMIT recent."""
        active = [run for run in runs if run.status in ACTIVE_STATUSES]
        recent = [run for run in runs if run.status not in ACTIVE_STATUSES]
        active.sort(key=lambda run: (_parse_created(run.created), run.run_id or ""))
        recent.sort(
            key=lambda run: (_parse_created(run.created), run.run_id or ""),
            reverse=True,
        )
        return cls(tuple(active), tuple(recent[:RECENT_LIMIT]))

    @classmethod
    def from_project_states(cls, states: list[ProjectState]) -> TaskIndex:
        """Flatten runs from every project state, then apply the same split and cap."""
        runs: list[RunRecord] = []
        for state in states:
            runs.extend(state.runs)
        return cls.from_runs(runs)
