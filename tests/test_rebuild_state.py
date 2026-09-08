"""CLI tests for tools.rebuild_state."""

from __future__ import annotations

import json
from pathlib import Path

from tools.rebuild_state import main

DIR = "2026-09-08--investigate-structures"


def _spec(run_id: str) -> str:
    return (
        "---\n"
        f"run_id: {run_id}\n"
        "created: 2026-09-08\n"
        "status: done\n"
        "workflow: investigate\n"
        "workspace: /work\n"
        "---\n\n"
        "# Investigate\n\n"
        "## Original request\n\n"
        "Investigate the thing.\n"
    )


def _report(token: str) -> str:
    return (
        "---\n"
        "author: codex (rlm, openai-codex/gpt-5.6-sol, medium)\n"
        "role: investigator\n"
        "date: 2026-09-08\n"
        "---\n\n"
        f"# Report {token}\n"
    )


def _state(project: str, runs: list[dict]) -> dict:
    return {
        "project": project,
        "path": "/work",
        "runs": runs,
        "archived": 0,
    }


def _write_project(root: Path) -> Path:
    """Build a small drifted project in tmp: one recorded run missing its job."""
    project = root / "projects" / "demo"
    (project / "tasks" / DIR).mkdir(parents=True)
    (project / "state.json").write_text(
        json.dumps(
            _state(
                "demo",
                [
                    {
                        "run_id": "2026-09-08-0035-investigate",
                        "title": "Investigate structures",
                        "workflow": "investigate",
                        "status": "awaiting-approval",
                        "created": "2026-09-08T00:35:00",
                        "task_file": f"tasks/{DIR}/00-task.md",
                        "workspace": "/work",
                        "jobs": [],
                    }
                ],
            )
        ),
        encoding="utf-8",
    )
    (project / "tasks" / DIR / "00-task.md").write_text(
        _spec("2026-09-08-0035-investigate"), encoding="utf-8"
    )
    (project / "tasks" / DIR / "01-investigate.md").write_text(
        _report("investigate"), encoding="utf-8"
    )
    return project


def _state_text(project: Path) -> str:
    return (project / "state.json").read_text(encoding="utf-8")


def test_dry_run_writes_nothing(tmp_path: Path) -> None:
    # arrange
    project = _write_project(tmp_path)
    state_before = _state_text(project)

    # act
    code = main(["--project", "demo", "--repo-root", str(tmp_path)])

    # assert
    assert code == 0
    assert _state_text(project) == state_before
    assert not (project / "TASKS.md").exists()
    assert not (tmp_path / "TASKS.md").exists()


def test_write_commits_and_followup_dry_run_reports_no_changes(tmp_path: Path) -> None:
    # arrange
    project = _write_project(tmp_path)

    # act
    dry_code = main(["--project", "demo", "--repo-root", str(tmp_path)])
    write_code = main(
        ["--project", "demo", "--repo-root", str(tmp_path), "--write"]
    )
    second_dry_code = main(["--project", "demo", "--repo-root", str(tmp_path)])

    # assert
    assert dry_code == 0
    assert write_code == 0
    assert second_dry_code == 0
    assert (project / "TASKS.md").is_file()
    assert (tmp_path / "TASKS.md").is_file()
    state = json.loads(_state_text(project))
    run = state["runs"][0]
    assert run["task_file"] == f"tasks/{DIR}/00-task.md"
    assert run["status"] == "awaiting-approval"  # recorded lifecycle preserved
    assert run["created"] == "2026-09-08T00:35:00"
    assert [job["job"] for job in run["jobs"]] == ["investigate"]
    assert run["jobs"][0]["status"] == "done"


def test_missing_project_fails(tmp_path: Path) -> None:
    # arrange / act / assert
    assert main(["--project", "nope", "--repo-root", str(tmp_path)]) == 1


def test_invalid_state_fails(tmp_path: Path) -> None:
    # arrange
    project = _write_project(tmp_path)
    (project / "state.json").write_text("{not json", encoding="utf-8")

    # act / assert
    assert main(["--project", "demo", "--repo-root", str(tmp_path)]) == 1
