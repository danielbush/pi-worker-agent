"""APPLICATION: reproduce the manager's per-project TASKS.md format."""

from __future__ import annotations

from datetime import datetime
from pathlib import PurePosixPath
from typing import Any

from tools.lib.core.domain.project_state import ProjectState
from tools.lib.core.domain.run_record import RunRecord
from tools.lib.core.domain.task_index import TaskIndex


def _format_date(value: str | None) -> str:
    if not value:
        return "—"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return "—"
    return parsed.strftime("%Y-%m-%d %H:%M %z")


def _cell(value: Any) -> str:
    text = "—" if value in (None, "") else str(value)
    return text.replace("|", "\\|").replace("\n", " ")


def _code_cell(value: str | None) -> str:
    return "—" if not value else f"`{value}`"


def _track_directory_names(run: RunRecord) -> list[str]:
    """Sorted track names derived from the run's recorded control paths.

    A recorded `task_file` or `report_file` is either a direct job file at the
    task root, `tasks/<taskdir>/<file>`, or one level deeper inside a track,
    `tasks/<taskdir>/<NN>-<description>/<file>`. The immediate parent directory
    of a nested file is the track name; membership never needs its own state.
    """
    names: set[str] = set()
    recorded = (run.task_file, *(job.report_file for job in run.jobs))
    for value in recorded:
        if not value:
            continue
        parts = PurePosixPath(value).parts
        if len(parts) == 4 and parts[0] == "tasks":
            names.add(parts[2])
    return sorted(names)


def _details_link(run: RunRecord) -> str:
    """Details cell: the task link, plus any tracks the recorded files use."""
    tracks = _track_directory_names(run)
    if not run.task_file:
        return "—"
    link = f"[task]({run.task_file})"
    if not tracks:
        return link
    return f"{link} — tracks: {', '.join(tracks)}"


def _row(values: list[Any]) -> str:
    return "| " + " | ".join(_cell(value) for value in values) + " |"


def _job_summary(run: RunRecord) -> str:
    current = next(
        (job for job in run.jobs if job.status in ("running", "queued")), None
    )
    if run.status == "blocked":
        done = [job for job in run.jobs if job.status in ("done", "failed")]
        last = done[-1] if done else (run.jobs[-1] if run.jobs else None)
        if last:
            suffix = "failed" if last.status == "failed" else "pending"
            return f"blocked — {last.job} {suffix}"
    if run.status == "running" and current:
        return f"running — {current.job} {current.status}"
    return run.status or "—"


def render_project_tasks_markdown(state: ProjectState, generated_at: str) -> str:
    """Format one validated project state using the manager's golden layout."""
    index = TaskIndex.from_runs(state.runs)
    output = [
        f"# Tasks\n\nGenerated from `state.json`: {generated_at}\n",
        "Do not edit manually. This file is a human-readable view maintained by the",
        "manager; `state.json` is the source of truth.\n",
        "## Active\n",
        "| Date | Task | Status | Workflow | Workspace | Details |",
        "|---|---|---|---|---|---|",
    ]
    for run in index.active:
        output.append(
            _row(
                [
                    _format_date(run.created),
                    run.title,
                    _job_summary(run),
                    _code_cell(run.workflow),
                    _code_cell(run.workspace),
                    _details_link(run),
                ]
            )
        )
    if not index.active:
        output.append("| — | No active tasks | — | — | — | — |")
    output.extend(
        [
            "",
            "## Recent\n",
            "| Date | Task | Status | Outcome | Details |",
            "|---|---|---|---|---|",
        ]
    )
    for run in index.recent:
        output.append(
            _row(
                [
                    _format_date(run.created),
                    run.title,
                    run.status,
                    run.outcome,
                    _details_link(run),
                ]
            )
        )
    if not index.recent:
        output.append("| — | No completed tasks yet | — | — | — |")
    return "\n".join(output) + "\n"
