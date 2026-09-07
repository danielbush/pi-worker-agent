"""APPLICATION: writes TASKS.md and answers `--check` staleness."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from pathlib import Path

from tools.lib.application.render_tasks_markdown import (
    extract_generated_at,
    render_tasks_markdown,
)
from tools.lib.domain.project_state import ProjectState
from tools.lib.domain.task_index import TaskIndex
from tools.lib.infrastructure.filesystem import Filesystem


def _format_generated_at(moment: datetime | None = None) -> str:
    """Format a second-precision local ISO stamp, defaulting to now."""
    when = moment or datetime.now().astimezone()
    return when.isoformat(timespec="seconds")


class TasksIndexWriter:
    """INFRASTRUCTURE_CONSUMER that writes TASKS.md and answers `--check` staleness.

    Composes Filesystem, ProjectState discovery, TaskIndex, and render_tasks_markdown.
    """

    def __init__(self, repo_root: Path, filesystem: Filesystem) -> None:
        self.repo_root = repo_root
        self.filesystem = filesystem

    @staticmethod
    def create(repo_root: Path) -> TasksIndexWriter:
        return TasksIndexWriter(repo_root, Filesystem.create())

    @staticmethod
    def create_null(
        repo_root: Path,
        *,
        files: dict[str, str] | None = None,
        directories: Iterable[str] | None = None,
    ) -> TasksIndexWriter:
        return TasksIndexWriter(
            repo_root,
            Filesystem.create_null(files=files, directories=directories),
        )

    def write(self, generated_at: str | None = None) -> Path:
        output = self.tasks_path()
        self.filesystem.write_text(
            output, self.render(generated_at or _format_generated_at())
        )
        return output

    def is_current(self) -> bool:
        """True when TASKS.md matches a re-render that reuses its existing stamp."""
        output = self.tasks_path()
        if not self.filesystem.is_file(output):
            return False
        existing = self.filesystem.read_text(output)
        stamp = extract_generated_at(existing)
        return existing == self.render(stamp or _format_generated_at())

    def tasks_path(self) -> Path:
        return self.repo_root / "TASKS.md"

    def render(
        self, generated_at: str, project_state: ProjectState | None = None
    ) -> str:
        """Render with one validated candidate replacing its on-disk projection."""
        states = ProjectState.discover(self.repo_root / "projects", self.filesystem)
        if project_state is not None:
            states = [
                state for state in states if state.project != project_state.project
            ]
            states.append(project_state)
        return render_tasks_markdown(
            TaskIndex.from_project_states(states), generated_at
        )
