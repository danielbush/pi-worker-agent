"""Characterization tests for the manager's per-project index formatter."""

from __future__ import annotations

from fixtures import FIXED_STAMP
from tools.lib.core.application.render_project_tasks_markdown import (
    render_project_tasks_markdown,
)
from tools.lib.core.domain.project_state import ProjectState


def test_matches_golden_active_recent_and_empty_value_format() -> None:
    # arrange
    state = ProjectState.from_dict(
        "demo",
        {
            "project": "demo",
            "path": "/work/demo",
            "archived": 0,
            "runs": [
                {
                    "run_id": "one",
                    "title": "Running |\ntitle",
                    "workflow": "build",
                    "workspace": "/work/demo",
                    "status": "running",
                    "created": "2026-09-01T08:00:00+10:00",
                    "task_file": "tasks/one/00-task.md",
                    "jobs": [
                        {"job": "plan", "status": "done"},
                        {"job": "implement", "status": "queued"},
                    ],
                },
                {
                    "run_id": "two",
                    "title": "Blocked",
                    "workflow": "build",
                    "workspace": "/work/demo",
                    "status": "blocked",
                    "created": "2026-09-02T09:30:00+10:00",
                    "task_file": "tasks/two/00-task.md",
                    "jobs": [{"job": "review", "status": "failed"}],
                },
                {
                    "run_id": "three",
                    "title": "Finished",
                    "workflow": "quickfix",
                    "workspace": "/work/demo",
                    "status": "done",
                    "created": "2026-09-03T10:00:00+10:00",
                    "task_file": "tasks/three/00-task.md",
                    "outcome": "",
                    "jobs": [],
                },
            ],
        },
    )

    # act
    markdown = render_project_tasks_markdown(state, FIXED_STAMP)

    # assert
    assert markdown == (
        "# Tasks\n\n"
        f"Generated from `state.json`: {FIXED_STAMP}\n\n"
        "Do not edit manually. This file is a human-readable view maintained by the\n"
        "manager; `state.json` is the source of truth.\n\n"
        "## Active\n\n"
        "| Date | Task | Status | Workflow | Workspace | Details |\n"
        "|---|---|---|---|---|---|\n"
        "| 2026-09-01 08:00 +1000 | Running \\| title | running — implement queued | "
        "`build` | `/work/demo` | [task](tasks/one/00-task.md) |\n"
        "| 2026-09-02 09:30 +1000 | Blocked | blocked — review failed | "
        "`build` | `/work/demo` | [task](tasks/two/00-task.md) |\n\n"
        "## Recent\n\n"
        "| Date | Task | Status | Outcome | Details |\n"
        "|---|---|---|---|---|\n"
        "| 2026-09-03 10:00 +1000 | Finished | done | — | "
        "[task](tasks/three/00-task.md) |\n"
    )


def test_empty_tables_match_golden_rows() -> None:
    # arrange
    state = ProjectState.from_dict(
        "demo", {"project": "demo", "path": "/work/demo", "runs": []}
    )

    # act
    markdown = render_project_tasks_markdown(state, FIXED_STAMP)

    # assert
    assert "| — | No active tasks | — | — | — | — |" in markdown
    assert "| — | No completed tasks yet | — | — | — |" in markdown


def test_sorts_out_of_order_runs_like_root_index() -> None:
    # arrange
    state = ProjectState.from_dict(
        "demo",
        {
            "project": "demo",
            "path": "/work/demo",
            "runs": [
                {
                    "run_id": "active-new",
                    "title": "Active new",
                    "status": "running",
                    "created": "2026-09-03T08:00:00+10:00",
                },
                {
                    "run_id": "recent-old",
                    "title": "Recent old",
                    "status": "done",
                    "created": "2026-09-01T08:00:00+10:00",
                },
                {
                    "run_id": "active-missing",
                    "title": "Active missing",
                    "status": "queued",
                },
                {
                    "run_id": "recent-new",
                    "title": "Recent new",
                    "status": "failed",
                    "created": "2026-09-04T08:00:00+10:00",
                },
                {
                    "run_id": "active-old",
                    "title": "Active old",
                    "status": "blocked",
                    "created": "2026-09-02T08:00:00+10:00",
                },
                {
                    "run_id": "active-old-z",
                    "title": "Active old Z",
                    "status": "queued",
                    "created": "2026-09-02T08:00:00+10:00",
                },
                {
                    "run_id": "recent-invalid",
                    "title": "Recent invalid",
                    "status": "cancelled",
                    "created": "not-a-date",
                },
            ],
        },
    )

    # act
    markdown = render_project_tasks_markdown(state, FIXED_STAMP)

    # assert
    assert markdown.index("Active missing") < markdown.index("Active old")
    assert markdown.index("Active old") < markdown.index("Active old Z")
    assert markdown.index("Active old Z") < markdown.index("Active new")
    assert markdown.index("Recent new") < markdown.index("Recent old")
    assert markdown.index("Recent old") < markdown.index("Recent invalid")


def test_missing_optional_run_fields_render_as_em_dashes() -> None:
    # arrange
    state = ProjectState.from_dict(
        "demo",
        {
            "project": "demo",
            "path": "/work/demo",
            "runs": [
                {"run_id": "active", "status": "running"},
                {
                    "run_id": "recent",
                    "status": "done",
                    "title": None,
                    "workflow": None,
                    "workspace": None,
                    "task_file": None,
                    "outcome": None,
                },
            ],
        },
    )

    # act
    markdown = render_project_tasks_markdown(state, FIXED_STAMP)

    # assert
    assert "| — | — | running | — | — | — |" in markdown
    assert "| — | — | done | — | — |" in markdown
    assert "None" not in markdown
    assert "[task](—)" not in markdown
