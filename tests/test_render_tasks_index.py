"""CLI tests for tools.render_tasks_index."""

from __future__ import annotations

from pathlib import Path

from fixtures import run, state_json
from tools.render_tasks_index import main


def test_main_cli_uses_temp_repo(tmp_path: Path) -> None:
    # arrange
    root = tmp_path
    project = root / "projects" / "demo"
    project.mkdir(parents=True)
    (project / "state.json").write_text(
        state_json(
            "demo",
            [
                run(
                    "2026-09-01-1000-build",
                    title="One",
                    status="done",
                    created="2026-09-01T10:00:00+10:00",
                )
            ],
        ),
        encoding="utf-8",
    )

    # act / assert
    assert main(["--repo-root", str(root), "--check"]) == 1
    assert not (root / "TASKS.md").exists()
    assert main(["--repo-root", str(root)]) == 0
    assert (root / "TASKS.md").is_file()
    assert main(["--repo-root", str(root), "--check"]) == 0
