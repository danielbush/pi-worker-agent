"""Tests for render_tasks_markdown."""

from __future__ import annotations

from fixtures import FIXED_STAMP, render_projects, run
from tools.lib.core.application.render_tasks_markdown import render_tasks_markdown
from tools.lib.core.domain.task_index import TaskIndex


def test_zero_runs_is_empty_tables() -> None:
    # arrange
    index = TaskIndex.from_runs([])

    # act
    markdown = render_tasks_markdown(index, FIXED_STAMP)

    # assert
    assert markdown.startswith("# All tasks\n")
    assert "No active tasks" in markdown
    assert "No completed tasks yet" in markdown
    assert "## Active" in markdown
    assert "## Recent" in markdown


def test_active_and_recent_sort_and_links() -> None:
    # arrange
    markdown = render_projects(
        {
            "demo": [
                run(
                    "2026-09-03-1200-build",
                    title="Newest active",
                    status="queued",
                    created="2026-09-03T12:00:00+10:00",
                ),
                run(
                    "2026-09-01-0800-build",
                    title="Oldest active",
                    status="running",
                    created="2026-09-01T08:00:00+10:00",
                ),
                run(
                    "2026-09-04-0900-build",
                    title="Blocked stays active",
                    status="blocked",
                    created="2026-09-02T09:00:00+10:00",
                ),
                run(
                    "2026-09-05-1500-build",
                    title="Newest done",
                    status="done",
                    created="2026-09-05T15:00:00+10:00",
                ),
                run(
                    "2026-09-04-1500-build",
                    title="Older done",
                    status="failed",
                    created="2026-09-04T15:00:00+10:00",
                ),
            ]
        }
    )

    # act
    active_pos = markdown.index("## Active")
    recent_pos = markdown.index("## Recent")

    # assert
    oldest = markdown.index("Oldest active")
    blocked = markdown.index("Blocked stays active")
    newest_active = markdown.index("Newest active")
    newest_done = markdown.index("Newest done")
    older_done = markdown.index("Older done")
    assert active_pos < oldest
    assert oldest < blocked
    assert blocked < newest_active
    assert newest_active < recent_pos
    assert newest_done < older_done
    assert "[demo](projects/demo/TASKS.md)" in markdown
    assert "[task](projects/demo/tasks/2026-09-01-0800-build/task.md)" in markdown
    assert "| queued |" in markdown
    assert "Generated from project `state.json` files: " + FIXED_STAMP in markdown
    assert "Do not edit manually." in markdown


def test_awaiting_approval_document_order() -> None:
    # arrange
    markdown = render_projects(
        {
            "demo": [
                run(
                    "2026-09-07-1030-quickfix",
                    title="Newer pending approval",
                    status="awaiting-approval",
                    created="2026-09-07T10:30:00+10:00",
                ),
                run(
                    "2026-09-07-1021-quickfix",
                    title="Older pending approval",
                    status="awaiting-approval",
                    created="2026-09-07T10:21:00+10:00",
                ),
                run(
                    "2026-09-06-1000-build",
                    title="Already done",
                    status="done",
                    created="2026-09-06T10:00:00+10:00",
                ),
            ]
        }
    )

    # act
    active_pos = markdown.index("## Active")
    recent_pos = markdown.index("## Recent")

    # assert
    older_pending = markdown.index("Older pending approval")
    newer_pending = markdown.index("Newer pending approval")
    done = markdown.index("Already done")
    assert active_pos < older_pending
    assert older_pending < newer_pending
    assert newer_pending < recent_pos
    assert recent_pos < done
    assert "| awaiting-approval |" in markdown
    assert "Already done" not in markdown[active_pos:recent_pos]
