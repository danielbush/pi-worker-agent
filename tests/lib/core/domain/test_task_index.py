"""Tests for TaskIndex."""

from __future__ import annotations

from fixtures import run_record
from tools.lib.core.domain.task_index import RECENT_LIMIT, TaskIndex


def test_awaiting_approval_is_active_not_recent() -> None:
    # arrange
    runs = [
        run_record(
            "2026-09-07-1030-quickfix",
            title="Newer pending approval",
            status="awaiting-approval",
            created="2026-09-07T10:30:00+10:00",
        ),
        run_record(
            "2026-09-07-1021-quickfix",
            title="Older pending approval",
            status="awaiting-approval",
            created="2026-09-07T10:21:00+10:00",
        ),
        run_record(
            "2026-09-06-1000-build",
            title="Already done",
            status="done",
            created="2026-09-06T10:00:00+10:00",
        ),
    ]

    # act
    index = TaskIndex.from_runs(runs)

    # assert
    assert [item.title for item in index.active] == [
        "Older pending approval",
        "Newer pending approval",
    ]
    assert [item.title for item in index.recent] == ["Already done"]


def test_recent_capped_at_twenty() -> None:
    # arrange
    runs = [
        run_record(
            f"2026-08-{day:02d}-1000-build",
            title=f"Done {day:02d}",
            status="done",
            created=f"2026-08-{day:02d}T10:00:00+10:00",
            project="many",
        )
        for day in range(1, 26)
    ]

    # act
    index = TaskIndex.from_runs(runs)

    # assert
    assert RECENT_LIMIT == 20
    assert len(index.recent) == 20
    assert index.recent[0].title == "Done 25"
    assert index.recent[-1].title == "Done 06"
