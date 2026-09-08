"""CLI tests for tools.archive_state."""

from __future__ import annotations

import json
from pathlib import Path

from tools.archive_state import main


def _run(rid: str, index: int) -> dict:
    return {
        "run_id": rid,
        "title": f"Run {index}",
        "status": "done",
        "created": f"2026-09-0{index % 9 + 1}T10:00:00",
        "task_file": f"tasks/{rid}/00-task.md",
        "workspace": "/work",
        "jobs": [
            {
                "job": "implement",
                "status": "done",
                "report_file": f"tasks/{rid}/01-implement.md",
            }
        ],
    }


def _state(project: str, runs: list[dict], archived: int = 0) -> dict:
    return {
        "project": project,
        "path": "/work",
        "runs": runs,
        "archived": archived,
    }


def _write_project(root: Path, count: int = 22) -> Path:
    """Build a project with `count` recorded runs in a tmp repo."""
    project = root / "projects" / "demo"
    project.mkdir(parents=True)
    runs = [
        _run(f"2026-09-08-{1000 + i}-x", i) for i in range(count)
    ]
    (project / "state.json").write_text(
        json.dumps(_state("demo", runs, archived=1)), encoding="utf-8"
    )
    (project / "history.jsonl").write_text(
        json.dumps(_run("2026-09-05-2249-old", 0)) + "\n", encoding="utf-8"
    )
    return project


def _state_text(project: Path) -> str:
    return (project / "state.json").read_text(encoding="utf-8")


def _history_text(project: Path) -> str:
    return (project / "history.jsonl").read_text(encoding="utf-8")


def test_dry_run_writes_nothing(tmp_path: Path) -> None:
    # arrange
    project = _write_project(tmp_path)
    state_before = _state_text(project)
    history_before = _history_text(project)

    # act
    code = main(["--project", "demo", "--repo-root", str(tmp_path)])

    # assert
    assert code == 0
    assert _state_text(project) == state_before
    assert _history_text(project) == history_before
    assert not (project / "TASKS.md").exists()
    assert not (tmp_path / "TASKS.md").exists()


def test_write_archives_oldest_and_commits_through_state_store(
    tmp_path: Path,
) -> None:
    # arrange
    project = _write_project(tmp_path)

    # act
    code = main(["--project", "demo", "--repo-root", str(tmp_path), "--write"])

    # assert: history is append-only; state keeps the most recent 20
    assert code == 0
    history_lines = _history_text(project).splitlines()
    assert len(history_lines) == 1 + 2
    assert json.loads(history_lines[0])["run_id"] == "2026-09-05-2249-old"
    assert json.loads(history_lines[1])["run_id"] == "2026-09-08-1000-x"
    assert json.loads(history_lines[2])["run_id"] == "2026-09-08-1001-x"
    state = json.loads(_state_text(project))
    assert len(state["runs"]) == 20
    assert state["runs"][0]["run_id"] == "2026-09-08-1002-x"
    assert state["archived"] == 1 + 2
    assert (project / "TASKS.md").is_file()
    assert (tmp_path / "TASKS.md").is_file()


def test_write_is_idempotent_when_already_within_to(tmp_path: Path) -> None:
    # arrange: run the write once to trim, then again below the bound
    project = _write_project(tmp_path, count=25)
    assert main(["--project", "demo", "--repo-root", str(tmp_path), "--write"]) == 0
    state_before = _state_text(project)
    history_before = _history_text(project)
    archived_before = json.loads(state_before)["archived"]

    # act
    code = main(["--project", "demo", "--repo-root", str(tmp_path), "--write"])

    # assert: a second write at the same bound archives nothing
    assert code == 0
    assert _state_text(project) == state_before
    assert _history_text(project) == history_before
    assert json.loads(state_before)["archived"] == archived_before


def test_to_flag_keeps_custom_count(tmp_path: Path) -> None:
    # arrange
    project = _write_project(tmp_path)

    # act
    code = main(
        ["--project", "demo", "--repo-root", str(tmp_path), "--to", "5", "--write"]
    )

    # assert
    assert code == 0
    state = json.loads(_state_text(project))
    assert len(state["runs"]) == 5
    assert state["runs"][0]["run_id"] == "2026-09-08-1017-x"
    assert state["archived"] == 1 + 17
    history_lines = _history_text(project).splitlines()
    assert len(history_lines) == 1 + 17


def test_missing_project_fails(tmp_path: Path) -> None:
    # arrange / act / assert
    assert main(["--project", "nope", "--repo-root", str(tmp_path)]) == 1


def test_invalid_state_fails(tmp_path: Path) -> None:
    # arrange
    project = _write_project(tmp_path)
    (project / "state.json").write_text("{not json", encoding="utf-8")

    # act / assert
    assert main(["--project", "demo", "--repo-root", str(tmp_path)]) == 1


def test_negative_to_fails(tmp_path: Path) -> None:
    # arrange
    _write_project(tmp_path)

    # act / assert
    assert main(["--project", "demo", "--repo-root", str(tmp_path), "--to", "-1"]) == 1
