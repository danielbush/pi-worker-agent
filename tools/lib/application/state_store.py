"""APPLICATION: validated state updates coupled to both generated task indexes."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from tools.lib.application.project_tasks_index_writer import ProjectTasksIndexWriter
from tools.lib.application.tasks_index_writer import TasksIndexWriter
from tools.lib.domain.project_state import ProjectState
from tools.lib.domain.project_state_validation import (
    ProjectStateValidationError,
    validate_project_state,
)
from tools.lib.infrastructure.filesystem import Filesystem


class StateStoreLoadError(ValueError):
    """A project state file could not be loaded strictly."""


class StateStoreCommitError(OSError):
    """One individually atomic file replacement failed during a commit."""


def _local_now() -> datetime:
    return datetime.now().astimezone()


class StateStore:
    """Own the load, update, validate, render, and ordered commit use case.

    Each destination is replaced atomically, but the three-file commit is not a
    transaction. Indexes are committed first so a committed authoritative state
    file never points at stale indexes. Failed updates retain the last successful
    in-memory snapshot, allowing the same instance to be retried safely.
    """

    def __init__(
        self,
        project_dir: Path,
        repo_root: Path,
        filesystem: Filesystem,
        document: dict[str, Any],
        clock: Callable[[], datetime] = _local_now,
    ) -> None:
        self.project_dir = project_dir
        self.repo_root = repo_root
        self.filesystem = filesystem
        self._document = document
        self._clock = clock
        self._project_index = ProjectTasksIndexWriter(project_dir, filesystem)
        self._root_index = TasksIndexWriter(repo_root, filesystem)

    @classmethod
    def load(cls, project_dir: Path) -> StateStore:
        resolved_dir = project_dir.resolve()
        repo_root = cls._derive_repo_root(resolved_dir)
        filesystem = Filesystem.create()
        document = cls._load_document(resolved_dir, filesystem)
        return cls(resolved_dir, repo_root, filesystem, document)

    @classmethod
    def create_null(
        cls,
        project_dir: Path,
        *,
        filesystem: Filesystem | None = None,
        files: dict[str, str] | None = None,
        directories: Iterable[str] | None = None,
        atomic_write_failures: Iterable[str] | None = None,
        clock: Callable[[], datetime] = _local_now,
    ) -> StateStore:
        repo_root = cls._derive_repo_root(project_dir)
        shared_filesystem = filesystem or Filesystem.create_null(
            files=files,
            directories=directories,
            atomic_write_failures=atomic_write_failures,
        )
        document = cls._load_document(project_dir, shared_filesystem)
        return cls(project_dir, repo_root, shared_filesystem, document, clock)

    def update(
        self, transform: Callable[[dict[str, Any]], Mapping[str, Any]]
    ) -> dict[str, Any]:
        """Commit one complete transformed document and return a detached snapshot."""
        working_copy = copy.deepcopy(self._document)
        transformed = transform(working_copy)
        if not isinstance(transformed, Mapping):
            raise ProjectStateValidationError(["$: expected object"])
        candidate = copy.deepcopy(dict(transformed))
        validate_project_state(
            candidate,
            self.project_dir.name,
            baseline=self._document,
        )
        serialized = (
            json.dumps(candidate, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        )
        projection = ProjectState.from_dict(self.project_dir.name, candidate)
        generated_at = self._clock().astimezone().isoformat(timespec="seconds")

        try:
            project_markdown = self._project_index.render(projection, generated_at)
        except Exception as error:
            raise StateStoreCommitError(
                f"render project index failed for {self._project_index.tasks_path()}: {error}"
            ) from error
        try:
            root_markdown = self._root_index.render(generated_at, projection)
        except Exception as error:
            raise StateStoreCommitError(
                f"render root index failed for {self._root_index.tasks_path()}: {error}"
            ) from error

        self._atomic_replace(
            self._project_index.tasks_path(), project_markdown, "project index commit"
        )
        self._atomic_replace(
            self._root_index.tasks_path(), root_markdown, "root index commit"
        )
        self._atomic_replace(self.state_path(), serialized, "state commit")
        self._document = candidate
        return copy.deepcopy(candidate)

    def snapshot(self) -> dict[str, Any]:
        """Return a detached copy of the last successfully loaded or committed state."""
        return copy.deepcopy(self._document)

    def state_path(self) -> Path:
        return self.project_dir / "state.json"

    def _atomic_replace(self, path: Path, text: str, phase: str) -> None:
        try:
            self.filesystem.atomic_write_text(path, text)
        except OSError as error:
            raise StateStoreCommitError(
                f"{phase} failed for {path}: {error}"
            ) from error

    @staticmethod
    def _derive_repo_root(project_dir: Path) -> Path:
        if project_dir.parent.name != "projects" or not project_dir.name:
            raise StateStoreLoadError(
                f"project directory must have <repo>/projects/<project> layout: {project_dir}"
            )
        return project_dir.parent.parent

    @staticmethod
    def _empty_document(project_name: str) -> dict[str, Any]:
        return {
            "project": project_name,
            "path": "",
            "runs": [],
            "archived": 0,
        }

    @staticmethod
    def _load_document(project_dir: Path, filesystem: Filesystem) -> dict[str, Any]:
        state_path = project_dir / "state.json"
        try:
            text = filesystem.read_text(state_path)
        except FileNotFoundError:
            parsed: object = StateStore._empty_document(project_dir.name)
        except OSError as error:
            raise StateStoreLoadError(
                f"read state failed for {state_path}: {error}"
            ) from error
        else:
            try:
                parsed = json.loads(text, parse_constant=_reject_json_constant)
            except (json.JSONDecodeError, ValueError) as error:
                message = (
                    error.msg if isinstance(error, json.JSONDecodeError) else str(error)
                )
                raise StateStoreLoadError(
                    f"parse state failed for {state_path}: {message}"
                ) from error
        if not isinstance(parsed, dict):
            raise StateStoreLoadError(
                f"parse state failed for {state_path}: expected top-level object"
            )
        try:
            validate_project_state(parsed, project_dir.name, baseline=parsed)
        except ValueError as error:
            raise StateStoreLoadError(
                f"validate state failed for {state_path}: {error}"
            ) from error
        return copy.deepcopy(parsed)


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON constant {value!r}")
