"""Tests for TasksIndexWriter."""

from __future__ import annotations

from pathlib import Path

from fixtures import FIXED_STAMP, null_projects_fs, run
from tools.lib.application.tasks_index_writer import TasksIndexWriter
from tools.lib.domain.project_state import ProjectState


def test_write_and_check_round_trip_with_null_filesystem() -> None:
    # arrange
    root = Path("/repo")
    filesystem = null_projects_fs(
        root,
        {
            "demo": [
                run(
                    "2026-09-01-1000-build",
                    title="One",
                    status="done",
                    created="2026-09-01T10:00:00+10:00",
                )
            ]
        },
    )
    writer = TasksIndexWriter(root, filesystem)

    # act
    written = writer.write(FIXED_STAMP)

    # assert
    assert written == root / "TASKS.md"
    assert writer.is_current()
    filesystem.write_text(written, filesystem.read_text(written) + "\nextra\n")
    assert not writer.is_current()


def test_check_missing_file() -> None:
    # arrange
    writer = TasksIndexWriter.createNull(Path("/repo"), directories=["/repo/projects"])

    # act
    current = writer.is_current()

    # assert
    assert not current


def test_candidate_override_is_byte_identical_to_same_on_disk_state() -> None:
    # arrange
    root = Path("/repo")
    runs = [
        run(
            "2026-09-01-1000-build",
            title="One",
            status="done",
            created="2026-09-01T10:00:00+10:00",
        )
    ]
    writer = TasksIndexWriter(root, null_projects_fs(root, {"demo": runs}))
    candidate = ProjectState.from_dict("demo", {"project": "demo", "runs": runs})

    # act
    discovered = writer.render(FIXED_STAMP)
    overridden = writer.render(FIXED_STAMP, candidate)

    # assert
    assert overridden == discovered
