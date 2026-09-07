"""APPLICATION: renders and writes one project's TASKS.md index."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from tools.lib.application.render_project_tasks_markdown import (
    render_project_tasks_markdown,
)
from tools.lib.domain.project_state import ProjectState
from tools.lib.infrastructure.filesystem import Filesystem


class ProjectTasksIndexWriter:
    """INFRASTRUCTURE_CONSUMER for a single project's generated task index."""

    def __init__(self, project_dir: Path, filesystem: Filesystem) -> None:
        self.project_dir = project_dir
        self.filesystem = filesystem

    @staticmethod
    def create(project_dir: Path) -> ProjectTasksIndexWriter:
        return ProjectTasksIndexWriter(project_dir, Filesystem.create())

    @staticmethod
    def create_null(
        project_dir: Path,
        *,
        files: dict[str, str] | None = None,
        directories: Iterable[str] | None = None,
    ) -> ProjectTasksIndexWriter:
        return ProjectTasksIndexWriter(
            project_dir,
            Filesystem.create_null(files=files, directories=directories),
        )

    def tasks_path(self) -> Path:
        return self.project_dir / "TASKS.md"

    def render(self, state: ProjectState, generated_at: str) -> str:
        return render_project_tasks_markdown(state, generated_at)

    def write(self, state: ProjectState, generated_at: str) -> Path:
        output = self.tasks_path()
        self.filesystem.atomic_write_text(output, self.render(state, generated_at))
        return output
