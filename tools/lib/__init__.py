"""Application library for the TASKS.md generator (`src` equivalent)."""

from tools.lib.application import (
    ProjectTasksIndexWriter,
    StateStore,
    StateStoreCommitError,
    StateStoreLoadError,
    TasksIndexWriter,
    extract_generated_at,
    render_project_tasks_markdown,
    render_tasks_markdown,
)
from tools.lib.domain import (
    JobRecord,
    ProjectState,
    ProjectStateValidationError,
    RunRecord,
    TaskIndex,
    validate_project_state,
)
from tools.lib.infrastructure import (
    EmbeddedPathStub,
    Filesystem,
    OperatingSystemPaths,
    PathDriver,
)

__all__ = [
    "EmbeddedPathStub",
    "Filesystem",
    "JobRecord",
    "OperatingSystemPaths",
    "PathDriver",
    "ProjectState",
    "ProjectStateValidationError",
    "ProjectTasksIndexWriter",
    "RunRecord",
    "StateStore",
    "StateStoreCommitError",
    "StateStoreLoadError",
    "TaskIndex",
    "TasksIndexWriter",
    "extract_generated_at",
    "render_project_tasks_markdown",
    "render_tasks_markdown",
    "validate_project_state",
]
