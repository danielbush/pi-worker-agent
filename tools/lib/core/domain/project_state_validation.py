"""DOMAIN: strict write-boundary validation for raw project state documents.

Pre-existing unknown fields are associated by run ID and, within each run, by
job name plus occurrence. Reordering or removing duplicate same-name jobs can
therefore make ownership of their unknown extensions ambiguous.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from math import isfinite
from pathlib import PurePosixPath
from typing import Any

from tools.lib.core.domain.job_record import JobRecord
from tools.lib.core.domain.project_state import ProjectState
from tools.lib.core.domain.run_record import RunRecord

RUN_STATUSES = frozenset(
    {
        "awaiting-approval",
        "queued",
        "running",
        "awaiting-user-review",
        "blocked",
        "done",
        "failed",
        "cancelled",
    }
)
JOB_STATUSES = frozenset(
    {"pending", "queued", "running", "blocked", "done", "failed", "cancelled"}
)

_RUN_TEXT_FIELDS = ("title", "workflow", "request", "workspace", "note")
_RUN_TIMESTAMP_FIELDS = ("created", "approved", "started", "finished")
_JOB_TEXT_FIELDS = (
    "job",
    "harness",
    "model",
    "thinking",
    "report_file",
    "output",
    "harness_log",
    "harness_session",
    "session_id",
    "heartbeat_id",
    "failure_kind",
    "error",
    "note",
)
_JOB_TIMESTAMP_FIELDS = ("started", "finished")
_JOB_INTEGER_FIELDS = ("attempt", "code_attempt", "process_pid", "exit_code")


class ProjectStateValidationError(ValueError):
    """All path-oriented problems found in one candidate state document."""

    def __init__(self, issues: list[str]) -> None:
        self.issues = tuple(issues)
        super().__init__(
            "Invalid project state:\n" + "\n".join(f"- {i}" for i in issues)
        )


def validate_project_state(
    document: Any,
    project_name: str,
    *,
    baseline: Mapping[str, Any] | None = None,
) -> None:
    """Validate a complete raw state document, collecting every detectable issue."""
    issues: list[str] = []
    if not isinstance(document, Mapping):
        raise ProjectStateValidationError(["$: expected object"])

    _validate_json_value(document, "$", issues)
    baseline_document = baseline if baseline is not None else document
    _validate_unknown_fields(
        document, baseline_document, ProjectState.KNOWN_FIELDS, "$", issues
    )
    _required_text(document, "project", "$", issues)
    if document.get("project") != project_name:
        issues.append(f"project: expected {project_name!r}")
    _required_text(document, "path", "$", issues, allow_empty=True)

    archived = document.get("archived")
    if type(archived) is not int or archived < 0:
        issues.append("archived: expected non-negative integer")

    runs = document.get("runs")
    if not isinstance(runs, list):
        issues.append("runs: expected list")
        _raise_if_issues(issues)
        return

    baseline_runs = _runs_by_id(baseline_document.get("runs"))
    seen_run_ids: set[str] = set()
    for run_index, run in enumerate(runs):
        path = f"runs[{run_index}]"
        if not isinstance(run, Mapping):
            issues.append(f"{path}: expected object")
            continue
        run_id = run.get("run_id")
        original_run = baseline_runs.get(run_id) if isinstance(run_id, str) else None
        _validate_unknown_fields(
            run, original_run, RunRecord.KNOWN_FIELDS, path, issues
        )
        _validate_run(run, path, issues)
        if isinstance(run_id, str) and run_id:
            if run_id in seen_run_ids:
                issues.append(f"{path}.run_id: duplicate value {run_id!r}")
            seen_run_ids.add(run_id)
        _validate_jobs(run, original_run, path, issues)

    _raise_if_issues(issues)


def _validate_run(run: Mapping[str, Any], path: str, issues: list[str]) -> None:
    _required_text(run, "run_id", path, issues)
    _required_text(run, "status", path, issues)
    status = run.get("status")
    if isinstance(status, str) and status not in RUN_STATUSES:
        issues.append(f"{path}.status: unknown run status {status!r}")

    for field in _RUN_TEXT_FIELDS:
        _optional_text(run, field, path, issues)
    _optional_text(run, "outcome", path, issues, allow_null=True)
    for field in _RUN_TIMESTAMP_FIELDS:
        _optional_timestamp(run, field, path, issues)
    if "task_file" in run:
        value = run["task_file"]
        if not isinstance(value, str):
            issues.append(f"{path}.task_file: expected string")
        elif not _is_safe_relative_path(value):
            issues.append(f"{path}.task_file: expected safe project-relative path")
    if "review_failures" in run:
        value = run["review_failures"]
        if value is not None and (type(value) is not int or value < 0):
            issues.append(
                f"{path}.review_failures: expected non-negative integer or null"
            )
    for field in ("result_ref", "manager_checks"):
        if (
            field in run
            and run[field] is not None
            and not isinstance(run[field], Mapping)
        ):
            issues.append(f"{path}.{field}: expected object or null")


def _validate_jobs(
    run: Mapping[str, Any],
    original_run: Mapping[str, Any] | None,
    run_path: str,
    issues: list[str],
) -> None:
    jobs = run.get("jobs", [])
    if not isinstance(jobs, list):
        issues.append(f"{run_path}.jobs: expected list")
        return
    originals = _jobs_by_name(original_run.get("jobs") if original_run else None)
    occurrences: dict[str, int] = {}
    for job_index, job in enumerate(jobs):
        path = f"{run_path}.jobs[{job_index}]"
        if not isinstance(job, Mapping):
            issues.append(f"{path}: expected object")
            continue
        name = job.get("job")
        occurrence = occurrences.get(name, 0) if isinstance(name, str) else 0
        if isinstance(name, str):
            occurrences[name] = occurrence + 1
        candidates = originals.get(name, []) if isinstance(name, str) else []
        original = candidates[occurrence] if occurrence < len(candidates) else None
        _validate_unknown_fields(job, original, JobRecord.KNOWN_FIELDS, path, issues)
        _validate_job(job, path, issues)


def _validate_job(job: Mapping[str, Any], path: str, issues: list[str]) -> None:
    _required_text(job, "job", path, issues)
    _required_text(job, "status", path, issues)
    status = job.get("status")
    if isinstance(status, str) and status not in JOB_STATUSES:
        issues.append(f"{path}.status: unknown job status {status!r}")
    for field in _JOB_TEXT_FIELDS:
        if field != "job":
            _optional_text(job, field, path, issues)
    _optional_text(job, "route", path, issues, allow_null=True)
    for field in _JOB_TIMESTAMP_FIELDS:
        _optional_timestamp(job, field, path, issues)
    for field in _JOB_INTEGER_FIELDS:
        if field in job and job[field] is not None and type(job[field]) is not int:
            issues.append(f"{path}.{field}: expected integer or null")
    if "duration_seconds" in job:
        value = job["duration_seconds"]
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, int | float)
        ):
            issues.append(f"{path}.duration_seconds: expected number or null")
    if "attempts" in job:
        attempts = job["attempts"]
        valid_count = type(attempts) is int and attempts >= 0
        if attempts is not None and not isinstance(attempts, list) and not valid_count:
            issues.append(
                f"{path}.attempts: expected list, non-negative integer, or null"
            )


def _validate_unknown_fields(
    candidate: Mapping[str, Any],
    original: Mapping[str, Any] | None,
    known_fields: frozenset[str],
    path: str,
    issues: list[str],
) -> None:
    original = original or {}
    for key in candidate:
        if isinstance(key, str) and key not in known_fields and key not in original:
            issues.append(f"{_join(path, key)}: newly introduced unknown field")
    for key, value in original.items():
        if not isinstance(key, str) or key in known_fields:
            continue
        field_path = _join(path, key)
        if key not in candidate:
            issues.append(f"{field_path}: pre-existing unknown field must be preserved")
        elif candidate[key] != value:
            issues.append(f"{field_path}: pre-existing unknown value must be preserved")


def _validate_json_value(value: Any, path: str, issues: list[str]) -> None:
    if value is None or isinstance(value, str | bool | int):
        return
    if isinstance(value, float):
        if not isfinite(value):
            issues.append(f"{path}: expected finite JSON number")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_json_value(item, f"{path}[{index}]", issues)
        return
    if isinstance(value, Mapping):
        for key, item in value.items():
            if not isinstance(key, str):
                issues.append(f"{path}: expected string object keys")
                continue
            _validate_json_value(item, _join(path, key), issues)
        return
    issues.append(f"{path}: expected JSON value")


def _required_text(
    value: Mapping[str, Any],
    field: str,
    path: str,
    issues: list[str],
    *,
    allow_empty: bool = False,
) -> None:
    item = value.get(field)
    if not isinstance(item, str) or (not allow_empty and not item):
        qualifier = "" if allow_empty else " non-empty"
        issues.append(f"{_join(path, field)}: expected{qualifier} string")


def _optional_text(
    value: Mapping[str, Any],
    field: str,
    path: str,
    issues: list[str],
    *,
    allow_null: bool = False,
) -> None:
    if field not in value:
        return
    item = value[field]
    if isinstance(item, str) or (allow_null and item is None):
        return
    qualifier = " or null" if allow_null else ""
    issues.append(f"{_join(path, field)}: expected string{qualifier}")


def _optional_timestamp(
    value: Mapping[str, Any], field: str, path: str, issues: list[str]
) -> None:
    if field not in value or value[field] is None:
        return
    timestamp = value[field]
    if not isinstance(timestamp, str):
        issues.append(f"{_join(path, field)}: expected ISO timestamp string or null")
        return
    try:
        datetime.fromisoformat(timestamp)
    except ValueError:
        issues.append(f"{_join(path, field)}: expected ISO timestamp string or null")


def _is_safe_relative_path(value: str) -> bool:
    if not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts


def _runs_by_id(value: Any) -> dict[str, Mapping[str, Any]]:
    if not isinstance(value, list):
        return {}
    return {
        run["run_id"]: run
        for run in value
        if isinstance(run, Mapping) and isinstance(run.get("run_id"), str)
    }


def _jobs_by_name(value: Any) -> dict[str, list[Mapping[str, Any]]]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    if not isinstance(value, list):
        return grouped
    for job in value:
        if isinstance(job, Mapping) and isinstance(job.get("job"), str):
            grouped.setdefault(job["job"], []).append(job)
    return grouped


def _join(path: str, field: str) -> str:
    return field if path == "$" else f"{path}.{field}"


def _raise_if_issues(issues: list[str]) -> None:
    if issues:
        raise ProjectStateValidationError(issues)
