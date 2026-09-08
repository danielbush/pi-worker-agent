"""Read model for one run in a project state document."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar

from tools.lib.core.domain.job_record import JobRecord


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


@dataclass(frozen=True)
class RunRecord:
    """One run object from `state.json`, plus the owning project name."""

    KNOWN_FIELDS: ClassVar[frozenset[str]] = frozenset(
        {
            "run_id",
            "title",
            "workflow",
            "status",
            "created",
            "approved",
            "started",
            "finished",
            "request",
            "task_file",
            "workspace",
            "jobs",
            "outcome",
            "note",
            "result_ref",
            "review_failures",
            "manager_checks",
        }
    )

    project: str
    run_id: str | None = None
    title: str | None = None
    workflow: str | None = None
    status: str | None = None
    created: str | None = None
    task_file: str | None = None
    workspace: str | None = None
    outcome: str | None = None
    jobs: list[JobRecord] = field(default_factory=list)

    @classmethod
    def from_dict(cls, project: str, payload: Any) -> RunRecord | None:
        """Parse one run object; skip non-objects. Unknown fields are ignored."""
        if not isinstance(payload, dict):
            return None
        raw_jobs = payload.get("jobs")
        if not isinstance(raw_jobs, list):
            raw_jobs = []
        return cls(
            project=project,
            run_id=_optional_str(payload.get("run_id")),
            title=_optional_str(payload.get("title")),
            workflow=_optional_str(payload.get("workflow")),
            status=_optional_str(payload.get("status")),
            created=_optional_str(payload.get("created")),
            task_file=_optional_str(payload.get("task_file")),
            workspace=_optional_str(payload.get("workspace")),
            outcome=_optional_str(payload.get("outcome")),
            jobs=[
                job
                for item in raw_jobs
                if (job := JobRecord.from_dict(item)) is not None
            ],
        )
