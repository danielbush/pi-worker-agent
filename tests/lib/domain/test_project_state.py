"""Tests for ProjectState."""

from __future__ import annotations

from pathlib import Path

from fixtures import null_projects_fs, run
from tools.lib.domain.project_state import ProjectState


def test_skips_example_and_missing_state() -> None:
    # arrange
    root = Path("/repo")
    filesystem = null_projects_fs(
        root,
        {
            "alpha": [
                run(
                    "2026-09-01-1000-build",
                    title="Ship it",
                    status="done",
                    created="2026-09-01T10:00:00+10:00",
                )
            ],
            "example": [
                run(
                    "2026-09-02-1000-build",
                    title="Example only",
                    status="done",
                    created="2026-09-02T10:00:00+10:00",
                )
            ],
        },
        extra_dirs=["ghost"],
    )

    # act
    states = ProjectState.discover(root / "projects", filesystem)

    # assert
    names = [state.project for state in states]
    titles = [item.title for state in states for item in state.runs]
    assert names == ["alpha"]
    assert titles == ["Ship it"]
    assert states[0].archived == 0
    assert states[0].path is None


def test_invalid_payload_yields_no_runs() -> None:
    # arrange
    payload = ["not", "an", "object"]

    # act
    state = ProjectState.from_dict("broken", payload)

    # assert
    assert state.project == "broken"
    assert state.runs == []
    assert state.archived == 0
    assert state.path is None
