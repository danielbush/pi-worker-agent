"""Tests for archiving the oldest recorded runs out of one project's state."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools.lib.core.application.state_archiver import ArchiveError, StateArchiver
from tools.lib.core.application.state_store import StateStore
from tools.lib.core.infrastructure.filesystem import Filesystem

ROOT = Path("/repo")


def run(rid: str, index: int, **overrides: object) -> dict:
    base: dict[str, object] = {
        "run_id": rid,
        "title": f"Run {index}",
        "workflow": "manual",
        "status": "done",
        "created": f"2026-09-0{index % 9 + 1}T10:00:00",
        "task_file": f"tasks/{rid}/00-task.md",
        "workspace": "/work",
        "jobs": [
            {
                "job": "implement",
                "status": "done",
                "report_file": f"tasks/{rid}/01-implement.md",
                "session_id": f"sess-{rid}",
            }
        ],
    }
    base.update(overrides)
    return base


def state_json(project: str, runs: list[dict], archived: int = 0) -> str:
    return json.dumps(
        {"project": project, "path": "/work", "runs": runs, "archived": archived}
    )


def project_files(project: str, document: dict) -> dict[str, str]:
    return {
        str(ROOT / "projects" / project / "state.json"): json.dumps(document),
        str(ROOT / "projects" / project / "TASKS.md"): "stale project index\n",
        str(ROOT / "TASKS.md"): "stale root index\n",
    }


def make_fs(project: str, document: dict, history: str = "") -> Filesystem:
    files = project_files(project, document)
    if history:
        files[str(ROOT / "projects" / project / "history.jsonl")] = history
    return Filesystem.create_null(files=files)


def _many_runs(count: int) -> list[dict]:
    return [
        run(f"2026-09-08-{1000 + i}-x", i)
        # state records runs oldest first; prepend so ordering is explicit
        for i in range(count)
    ]


def test_archive_keeps_most_recent_n_and_archives_the_oldest() -> None:
    # arrange
    runs = _many_runs(23)
    document = json.loads(state_json("demo", runs, archived=2))
    fs = make_fs("demo", document)
    archiver = StateArchiver(ROOT / "projects/demo", fs)

    # act
    outcome = archiver.archive(document, to=20)

    # assert
    assert [r["run_id"] for r in outcome.archived_runs] == [
        r["run_id"] for r in runs[:3]
    ]
    assert [r["run_id"] for r in outcome.candidate["runs"]] == [
        r["run_id"] for r in runs[3:]
    ]
    assert len(outcome.candidate["runs"]) == 20
    assert outcome.candidate["archived"] == 2 + 3
    assert "archive 3" in "\n".join(outcome.lines)
    # nothing was written by archive() itself
    assert json.loads(fs.read_text(ROOT / "projects/demo/state.json")) == document


def _rich_run() -> dict:
    return {
        "run_id": "2026-09-08-0999-rich",
        "title": "Old",
        "workflow": "build",
        "status": "cancelled",
        "created": "2026-09-08T10:00:00",
        "started": "2026-09-08T10:00:05",
        "finished": "2026-09-08T10:01:00",
        "outcome": "Skipped",
        "request": "Do the thing",
        "task_file": "tasks/2026-09-08-0999-rich/00-task.md",
        "workspace": "/work",
        "run_extension": {"kept": True},
        "jobs": [
            {
                "job": "implement",
                "harness": "rlm",
                "model": "m",
                "thinking": "medium",
                "route": None,
                "status": "done",
                "report_file": "tasks/2026-09-08-0999-rich/01-implement.md",
                "started": "2026-09-08T10:00:10",
                "finished": "2026-09-08T10:00:50",
                "duration_seconds": 40,
                "session_id": "sess-1",
                "job_extension": [1, 2],
            }
        ],
    }


def test_archived_runs_are_complete_and_unchanged() -> None:
    # arrange: 22 runs, the oldest carrying jobs, fields, and extensions
    rich = _rich_run()
    runs = [rich] + _many_runs(21)
    document = json.loads(state_json("demo", runs, archived=0))
    fs = make_fs("demo", document)
    archiver = StateArchiver(ROOT / "projects/demo", fs)

    # act
    outcome = archiver.archive(document, to=20)

    # assert: the two oldest (rich run + first plain) are archived in full
    assert len(outcome.archived_runs) == 2
    assert outcome.archived_runs[0] == rich
    assert outcome.archived_runs[0]["run_extension"] == {"kept": True}
    assert outcome.archived_runs[0]["jobs"][0]["job_extension"] == [1, 2]
    assert outcome.archived_runs[0]["jobs"][0]["session_id"] == "sess-1"


def test_append_history_is_append_only_and_round_trips_json() -> None:
    # arrange
    runs = _many_runs(22)
    document = json.loads(state_json("demo", runs, archived=1))
    existing = (
        json.dumps(run("2026-09-05-2249-old", 0, status="cancelled"))
        + "\n"
        + json.dumps(run("2026-09-06-0100-older", 0, status="cancelled"))
        + "\n"
    )
    fs = make_fs("demo", document, history=existing)
    archiver = StateArchiver(ROOT / "projects/demo", fs)

    # act
    outcome = archiver.archive(document, to=20)
    archiver.append_history(outcome.archived_runs)

    # assert: prior history lines untouched, archived runs appended in order
    history = fs.read_text(ROOT / "projects/demo/history.jsonl")
    assert history.startswith(existing)
    lines = history.splitlines()
    assert len(lines) == 2 + 2
    assert json.loads(lines[2]) == runs[0]
    assert json.loads(lines[3]) == runs[1]
    assert [r["run_id"] for r in outcome.archived_runs] == [
        runs[0]["run_id"],
        runs[1]["run_id"],
    ]


def test_append_history_creates_missing_file() -> None:
    # arrange
    runs = _many_runs(21)
    document = json.loads(state_json("demo", runs))
    fs = make_fs("demo", document)  # no history.jsonl on disk
    archiver = StateArchiver(ROOT / "projects/demo", fs)

    # act
    outcome = archiver.archive(document, to=20)
    archiver.append_history(outcome.archived_runs)

    # assert
    lines = fs.read_text(ROOT / "projects/demo/history.jsonl").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0]) == runs[0]


def test_nothing_to_archive_when_at_or_below_to() -> None:
    # arrange
    runs = _many_runs(15)
    document = json.loads(state_json("demo", runs, archived=4))
    fs = make_fs("demo", document)
    archiver = StateArchiver(ROOT / "projects/demo", fs)

    # act
    outcome = archiver.archive(document, to=20)

    # assert
    assert outcome.archived_runs == []
    assert outcome.candidate["runs"] == runs
    assert outcome.candidate["archived"] == 4
    assert "nothing to archive" in "\n".join(outcome.lines)


def test_negative_to_is_rejected() -> None:
    # arrange
    document = json.loads(state_json("demo", _many_runs(3)))
    archiver = StateArchiver(ROOT / "projects/demo", make_fs("demo", document))

    # act / assert
    with pytest.raises(ArchiveError, match="--to must be >= 0"):
        archiver.archive(document, to=-1)


def test_state_store_round_trip_regenerates_indexes_and_increments_archived() -> None:
    # arrange
    runs = _many_runs(22)
    document = json.loads(state_json("demo", runs, archived=3))
    fs = make_fs("demo", document)
    project_dir = ROOT / "projects/demo"
    store = StateStore.create_null(project_dir, filesystem=fs)
    archiver = StateArchiver(project_dir, fs)

    # act: full command path -- append history, then commit through the store
    outcome = archiver.archive(store.snapshot(), to=20)
    archiver.append_history(outcome.archived_runs)
    committed = store.update(lambda _doc: outcome.candidate)

    # assert
    assert committed == outcome.candidate
    assert committed["archived"] == 3 + 2
    assert len(committed["runs"]) == 20
    assert json.loads(fs.read_text(project_dir / "state.json")) == committed
    project_index = fs.read_text(project_dir / "TASKS.md")
    assert "Generated from `state.json`" in project_index
    assert "[task]" in project_index
    root_index = fs.read_text(ROOT / "TASKS.md")
    assert "[demo](projects/demo/TASKS.md)" in root_index


def test_archive_leaves_other_projects_untouched() -> None:
    # arrange
    runs = _many_runs(22)
    document = json.loads(state_json("demo", runs))
    fs = make_fs("demo", document)
    other_state = json.dumps(
        {
            "project": "other",
            "path": "/work/other",
            "runs": [
                {
                    "run_id": "2026-09-08-0500-x",
                    "title": "Other",
                    "status": "done",
                    "created": "2026-09-08T05:00:00",
                    "task_file": "tasks/2026-09-08--other/00-task.md",
                }
            ],
            "archived": 0,
        }
    )
    fs.write_text(ROOT / "projects/other/state.json", other_state)
    project_dir = ROOT / "projects/demo"
    store = StateStore.create_null(project_dir, filesystem=fs)
    archiver = StateArchiver(project_dir, fs)
    other_before = fs.read_text(ROOT / "projects/other/state.json")

    # act
    outcome = archiver.archive(store.snapshot(), to=20)
    archiver.append_history(outcome.archived_runs)
    store.update(lambda _doc: outcome.candidate)

    # assert
    assert fs.read_text(ROOT / "projects/other/state.json") == other_before


def test_state_store_reload_after_archive_validates() -> None:
    # arrange
    runs = _many_runs(25)
    document = json.loads(state_json("demo", runs, archived=0))
    fs = make_fs("demo", document)
    project_dir = ROOT / "projects/demo"
    store = StateStore.create_null(project_dir, filesystem=fs)
    archiver = StateArchiver(project_dir, fs)

    # act: archive to 5, then reload the state through StateStore
    outcome = archiver.archive(store.snapshot(), to=5)
    archiver.append_history(outcome.archived_runs)
    store.update(lambda _doc: outcome.candidate)
    reloaded = StateStore.create_null(project_dir, filesystem=fs).snapshot()

    # assert
    assert reloaded == outcome.candidate
    assert len(reloaded["runs"]) == 5
    assert reloaded["archived"] == 20
