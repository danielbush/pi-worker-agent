"""APPLICATION: format a TaskIndex as the repository-root TASKS.md document."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from tools.lib.domain.run_record import RunRecord
from tools.lib.domain.task_index import TaskIndex

_STAMP_PREFIX = "Generated from project `state.json` files: "
_TABLE_COLUMNS = ("Date", "Project", "Task", "Status", "Details")


def _format_run_date(created: str | None) -> str:
    """Format a run `created` stamp for the index table, or an em dash if unusable."""
    if not created:
        return "—"
    try:
        parsed = datetime.fromisoformat(created)
    except ValueError:
        return "—"
    if parsed.tzinfo is None:
        return parsed.strftime("%Y-%m-%d %H:%M")
    return parsed.strftime("%Y-%m-%d %H:%M %z")


def extract_generated_at(markdown: str) -> str | None:
    """Extract the generated-at stamp from existing TASKS.md markdown, if present."""
    for line in markdown.splitlines():
        if line.startswith(_STAMP_PREFIX):
            return line.removeprefix(_STAMP_PREFIX).strip() or None
    return None


def _cell(value: Any) -> str:
    text = "—" if value in (None, "") else str(value)
    return text.replace("|", "\\|").replace("\n", " ")


def _project_link(project: str) -> str:
    return f"[{project}](projects/{project}/TASKS.md)"


def _details_link(project: str, task_file: str | None) -> str:
    if not task_file:
        return "—"
    path = task_file
    if not path.startswith("projects/"):
        path = f"projects/{project}/{path.lstrip('/')}"
    return f"[task]({path})"


def _row(run: RunRecord) -> list[str]:
    return [
        _format_run_date(run.created),
        _project_link(run.project),
        run.title or run.run_id or "—",
        run.status or "—",
        _details_link(run.project, run.task_file),
    ]


def _table(rows: list[list[str]], empty_message: str) -> str:
    """Render a five-column table, placing `empty_message` in the Task cell when empty."""
    header = "| " + " | ".join(_TABLE_COLUMNS) + " |"
    divider = "|" + "|".join("---" for _ in _TABLE_COLUMNS) + "|"
    if not rows:
        body = f"| — | — | {empty_message} | — | — |"
        return f"{header}\n{divider}\n{body}"
    rendered = ["| " + " | ".join(_cell(col) for col in row) + " |" for row in rows]
    return "\n".join((header, divider, *rendered))


def render_tasks_markdown(index: TaskIndex, generated_at: str) -> str:
    """Format a TaskIndex as the root TASKS.md document."""
    parts = [
        "# All tasks",
        "",
        f"{_STAMP_PREFIX}{generated_at}",
        "",
        "Do not edit manually. Generated index; `state.json` files are the",
        "source of truth.",
        "",
        "## Active",
        "",
        _table([_row(run) for run in index.active], "No active tasks"),
        "",
        "## Recent",
        "",
        _table([_row(run) for run in index.recent], "No completed tasks yet"),
        "",
    ]
    return "\n".join(parts)
