"""Shared run/state builders for TASKS.md generator tests."""

from __future__ import annotations

import json
from pathlib import Path

from tools.lib.application.render_tasks_markdown import render_tasks_markdown
from tools.lib.domain.project_state import ProjectState
from tools.lib.domain.run_record import RunRecord
from tools.lib.domain.task_index import TaskIndex
from tools.lib.infrastructure.filesystem import Filesystem

FIXED_STAMP = "2026-09-07T12:00:00+10:00"


def run(
    run_id: str,
    *,
    title: str,
    status: str,
    created: str,
    task_file: str | None = None,
) -> dict:
    return {
        "run_id": run_id,
        "title": title,
        "status": status,
        "created": created,
        "task_file": task_file or f"runs/{run_id}/task.md",
    }


def run_record(
    run_id: str,
    *,
    title: str,
    status: str,
    created: str,
    project: str = "demo",
    task_file: str | None = None,
) -> RunRecord:
    record = RunRecord.from_dict(
        project,
        run(run_id, title=title, status=status, created=created, task_file=task_file),
    )
    assert record is not None
    return record


def state_json(name: str, runs: list[dict]) -> str:
    return json.dumps({"project": name, "runs": runs, "archived": 0})


def null_projects_fs(
    root: Path,
    projects: dict[str, list[dict]],
    extra_dirs: list[str] | None = None,
) -> Filesystem:
    files = {
        str(root / "projects" / name / "state.json"): state_json(name, runs)
        for name, runs in projects.items()
    }
    directories = [str(root / "projects" / name) for name in (extra_dirs or [])]
    if extra_dirs and not projects:
        directories.append(str(root / "projects"))
    return Filesystem.createNull(files=files, directories=directories)


def render_projects(
    projects: dict[str, list[dict]], extra_dirs: list[str] | None = None
) -> str:
    root = Path("/repo")
    states = ProjectState.discover(
        root / "projects", null_projects_fs(root, projects, extra_dirs)
    )
    return render_tasks_markdown(TaskIndex.from_project_states(states), FIXED_STAMP)
