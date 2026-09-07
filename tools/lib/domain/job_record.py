"""Read model for one job in a project state document."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, ClassVar


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


@dataclass(frozen=True)
class JobRecord:
    """Read-only projection of one job used by project task indexes."""

    KNOWN_FIELDS: ClassVar[frozenset[str]] = frozenset(
        {
            "job",
            "harness",
            "model",
            "thinking",
            "route",
            "status",
            "report_file",
            "output",
            "started",
            "finished",
            "attempts",
            "attempt",
            "code_attempt",
            "harness_log",
            "harness_session",
            "session_id",
            "heartbeat_id",
            "process_pid",
            "exit_code",
            "duration_seconds",
            "failure_kind",
            "error",
            "note",
        }
    )

    job: str | None = None
    status: str | None = None

    @classmethod
    def from_dict(cls, payload: Any) -> JobRecord | None:
        """Parse one job object; skip non-objects and ignore unknown fields."""
        if not isinstance(payload, dict):
            return None
        return cls(
            job=_optional_str(payload.get("job")),
            status=_optional_str(payload.get("status")),
        )
