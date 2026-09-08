"""Sociable null-filesystem tests for the mediated project state write path."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from tools.lib.core.application.state_store import (
    StateStore,
    StateStoreCommitError,
    StateStoreLoadError,
)
from tools.lib.core.domain.project_state_validation import ProjectStateValidationError
from tools.lib.core.infrastructure.filesystem import Filesystem


def _fixed_now() -> datetime:
    return datetime.fromisoformat("2026-09-07T12:00:00+10:00")


def _document(title: str = "Original") -> dict:
    return {
        "project": "demo",
        "path": "/work/demo",
        "archived": 0,
        "extension": {"unicode": "café"},
        "runs": [
            {
                "run_id": "2026-09-07-1000-build",
                "title": title,
                "workflow": "build",
                "status": "running",
                "created": "2026-09-07T10:00:00+10:00",
                "request": "Build it",
                "task_file": "tasks/2026-09-07-1000-build/00-task.md",
                "workspace": "/work/demo",
                "run_extension": [1, 2],
                "jobs": [
                    {
                        "job": "implement",
                        "status": "queued",
                        "harness": "codex",
                        "model": "gpt-5.6-sol",
                        "thinking": "medium",
                        "route": None,
                        "job_extension": {"kept": True},
                    }
                ],
            }
        ],
    }


def _filesystem(
    root: Path, document: dict, *, failures: list[str] | None = None
) -> Filesystem:
    return Filesystem.create_null(
        files={
            str(root / "projects/demo/state.json"): json.dumps(document),
            str(root / "projects/other/state.json"): json.dumps(
                {"project": "other", "path": "/work/other", "runs": [], "archived": 0}
            ),
            str(root / "projects/demo/TASKS.md"): "stale project index\n",
            str(root / "TASKS.md"): "stale root index\n",
        },
        atomic_write_failures=failures,
    )


def test_update_preserves_extensions_and_regenerates_both_indexes() -> None:
    # arrange
    root = Path("/repo")
    filesystem = _filesystem(root, _document())
    store = StateStore.create_null(
        root / "projects/demo", filesystem=filesystem, clock=_fixed_now
    )

    def finish(document: dict) -> dict:
        document["runs"][0]["title"] = "Shipped"
        document["runs"][0]["status"] = "done"
        document["runs"][0]["outcome"] = "Useful"
        document["runs"][0]["jobs"][0]["status"] = "done"
        return document

    # act
    committed = store.update(finish)

    # assert
    state_text = filesystem.read_text(root / "projects/demo/state.json")
    assert state_text.endswith("\n")
    assert "café" in state_text
    assert json.loads(state_text) == committed
    assert committed["extension"] == {"unicode": "café"}
    assert committed["runs"][0]["run_extension"] == [1, 2]
    assert committed["runs"][0]["jobs"][0]["job_extension"] == {"kept": True}
    project_index = filesystem.read_text(root / "projects/demo/TASKS.md")
    root_index = filesystem.read_text(root / "TASKS.md")
    assert "Generated from `state.json`: 2026-09-07T12:00:00+10:00" in project_index
    assert "| 2026-09-07 10:00 +1000 | Shipped | done | Useful |" in project_index
    assert (
        "Generated from project `state.json` files: 2026-09-07T12:00:00+10:00"
        in root_index
    )
    assert "[demo](projects/demo/TASKS.md)" in root_index
    assert "Shipped" in root_index


def test_identity_update_regenerates_stale_indexes() -> None:
    # arrange
    root = Path("/repo")
    filesystem = _filesystem(root, _document())
    store = StateStore.create_null(
        root / "projects/demo", filesystem=filesystem, clock=_fixed_now
    )

    # act
    store.update(lambda state: state)

    # assert
    assert filesystem.read_text(root / "projects/demo/TASKS.md").startswith("# Tasks\n")
    assert filesystem.read_text(root / "TASKS.md").startswith("# All tasks\n")


def test_new_unknown_field_is_rejected_without_any_commit_and_store_can_retry() -> None:
    # arrange
    root = Path("/repo")
    original = _document()
    filesystem = _filesystem(root, original)
    store = StateStore.create_null(
        root / "projects/demo", filesystem=filesystem, clock=_fixed_now
    )

    def add_typo(document: dict) -> dict:
        document["runs"][0]["statsu"] = "done"
        return document

    # act
    with pytest.raises(ProjectStateValidationError, match="newly introduced unknown"):
        store.update(add_typo)
    retried = store.update(lambda state: state)

    # assert
    assert "statsu" not in retried["runs"][0]
    assert (
        json.loads(filesystem.read_text(root / "projects/demo/state.json")) == original
    )
    assert filesystem.read_text(root / "projects/demo/TASKS.md").startswith("# Tasks\n")


def test_failed_state_replacement_leaves_old_state_untorn() -> None:
    # arrange
    root = Path("/repo")
    state_path = root / "projects/demo/state.json"
    original = _document()
    filesystem = _filesystem(root, original, failures=[str(state_path)])
    store = StateStore.create_null(
        root / "projects/demo", filesystem=filesystem, clock=_fixed_now
    )

    def rename(document: dict) -> dict:
        document["runs"][0]["title"] = "Candidate"
        return document

    # act
    with pytest.raises(StateStoreCommitError, match="state commit failed") as caught:
        store.update(rename)

    # assert
    assert str(state_path) in str(caught.value)
    assert json.loads(filesystem.read_text(state_path)) == original
    assert store.snapshot() == original
    assert "Candidate" in filesystem.read_text(root / "projects/demo/TASKS.md")
    assert "Candidate" in filesystem.read_text(root / "TASKS.md")


def test_load_missing_state_uses_empty_document_and_first_update_round_trips(
    tmp_path: Path,
) -> None:
    # arrange
    project_dir = tmp_path / "repo" / "projects" / "fresh-proj"
    project_dir.mkdir(parents=True)
    expected = {
        "project": "fresh-proj",
        "path": "",
        "runs": [],
        "archived": 0,
    }

    # act
    store = StateStore.load(project_dir)
    initial = store.snapshot()
    committed = store.update(lambda state: state)
    reloaded = StateStore.load(project_dir).snapshot()

    # assert
    assert initial == expected
    assert committed == expected
    assert reloaded == expected
    assert json.loads((project_dir / "state.json").read_text()) == expected
    assert (project_dir / "TASKS.md").is_file()
    assert (tmp_path / "repo" / "TASKS.md").is_file()


def test_create_null_missing_state_uses_same_empty_document() -> None:
    # arrange
    project_dir = Path("/repo/projects/fresh-proj")
    filesystem = Filesystem.create_null(directories=[str(project_dir)])
    expected = {
        "project": "fresh-proj",
        "path": "",
        "runs": [],
        "archived": 0,
    }

    # act
    store = StateStore.create_null(project_dir, filesystem=filesystem)
    initial = store.snapshot()
    committed = store.update(lambda state: state)

    # assert
    assert initial == expected
    assert committed == expected
    assert json.loads(filesystem.read_text(project_dir / "state.json")) == expected


def test_load_reports_non_missing_read_oserror_with_state_path(tmp_path: Path) -> None:
    # arrange
    project_dir = tmp_path / "repo" / "projects" / "fresh-proj"
    project_dir.mkdir(parents=True)
    state_path = project_dir / "state.json"
    state_path.mkdir()

    # act
    with pytest.raises(StateStoreLoadError, match="read state failed") as caught:
        StateStore.load(project_dir)

    # assert
    assert str(state_path) in str(caught.value)
    assert isinstance(caught.value.__cause__, IsADirectoryError)


def test_load_reports_malformed_json_with_the_state_path() -> None:
    # arrange
    project_dir = Path("/repo/projects/demo")
    filesystem = Filesystem.create_null(
        files={str(project_dir / "state.json"): "{not json"}
    )

    # act
    with pytest.raises(StateStoreLoadError, match="parse state failed") as caught:
        StateStore.create_null(project_dir, filesystem=filesystem)

    # assert
    assert str(project_dir / "state.json") in str(caught.value)


def test_nested_task_and_report_paths_validate_and_round_trip() -> None:
    # arrange
    root = Path("/repo")
    document = _document()
    run = document["runs"][0]
    run["task_file"] = (
        "tasks/2026-09-07-1000-build/00-investigate/00-task.md"
    )
    run["jobs"][0]["report_file"] = (
        "tasks/2026-09-07-1000-build/00-investigate/01-investigate.md"
    )
    filesystem = _filesystem(root, document)
    store = StateStore.create_null(
        root / "projects/demo", filesystem=filesystem, clock=_fixed_now
    )

    # act
    committed = store.update(lambda state: state)

    # assert
    state_text = filesystem.read_text(root / "projects/demo/state.json")
    assert (
        "tasks/2026-09-07-1000-build/00-investigate/00-task.md" in state_text
    )
    assert committed["runs"][0]["task_file"] == (
        "tasks/2026-09-07-1000-build/00-investigate/00-task.md"
    )
    assert committed["runs"][0]["jobs"][0]["report_file"] == (
        "tasks/2026-09-07-1000-build/00-investigate/01-investigate.md"
    )
    project_index = filesystem.read_text(root / "projects/demo/TASKS.md")
    assert (
        "[task](tasks/2026-09-07-1000-build/00-investigate/00-task.md) — "
        "tracks: 00-investigate"
    ) in project_index
    root_index = filesystem.read_text(root / "TASKS.md")
    assert (
        "tasks/2026-09-07-1000-build/00-investigate/00-task.md" in root_index
    )
