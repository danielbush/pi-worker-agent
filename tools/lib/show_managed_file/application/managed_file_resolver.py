"""APPLICATION: resolve a request to one authoritative canonical file path."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.domain.managed_file_request import ManagedFileRequest
from tools.lib.show_managed_file.domain.managed_target import ManagedTarget, TargetScope
from tools.lib.show_managed_file.infrastructure.filesystem import (
    NULL_HOME,
    NULL_WORKING_DIRECTORY,
    Filesystem,
)

ACTIVE_STATUSES = frozenset({"queued", "running", "blocked"})
SENSITIVE_BASENAMES = frozenset(
    {"auth.json", ".env", "credentials.json", "id_rsa", "id_ed25519"}
)


class ManagedFileResolver:
    """Own project selection, run selection, containment, and file policy.

    Uses the Filesystem wrapper for every path fact; knows nothing about
    argparse, editors, or processes.
    """

    def __init__(self, filesystem: Filesystem) -> None:
        self._filesystem = filesystem

    @staticmethod
    def create() -> ManagedFileResolver:
        return ManagedFileResolver(Filesystem.create())

    @staticmethod
    def create_null(
        *,
        files: Mapping[str, str] | None = None,
        directories: Iterable[str] | None = None,
        home: str = NULL_HOME,
        working_directory: str = NULL_WORKING_DIRECTORY,
        links: Mapping[str, str] | None = None,
    ) -> ManagedFileResolver:
        return ManagedFileResolver(
            Filesystem.create_null(
                files=files,
                directories=directories,
                home=home,
                working_directory=working_directory,
                links=links,
            )
        )

    def resolve(self, request: ManagedFileRequest) -> Path:
        """Return the canonical path of the single file the request names."""
        if request.explicit_file is not None:
            return self._explicit_file(request.explicit_file)
        if request.target is None:
            raise ManagedFileError("either --target or --file is required")
        root = self._filesystem.canonical(request.root)
        return self._target_file(root, request.target, request.project, request.run_id)

    def _target_file(
        self,
        root: Path,
        target: ManagedTarget,
        project_name: str | None,
        run_id: str | None,
    ) -> Path:
        if target.scope is TargetScope.TASK:
            project_dir = self._select_project(root, project_name)
            return self._task_file(project_dir, run_id)
        base = self._base_for(target, root, project_name)
        return self._require_file(target.path_within(base), target.description)

    def _base_for(
        self, target: ManagedTarget, root: Path, project_name: str | None
    ) -> Path:
        if target.scope is TargetScope.HOME:
            return self._filesystem.home()
        if target.scope is TargetScope.REPOSITORY:
            return root
        return self._select_project(root, project_name)

    def _select_project(self, root: Path, name: str | None) -> Path:
        projects = root / "projects"
        if name:
            if Path(name).name != name or name in {".", ".."}:
                raise ManagedFileError(f"unsafe project name: {name!r}")
            candidate = projects / name
            if not self._filesystem.is_dir(candidate):
                raise ManagedFileError(f"managed project {name!r} does not exist")
            return candidate
        candidates = [
            projects / child
            for child in self._filesystem.child_names(projects)
            if self._filesystem.is_file(projects / child / "state.json")
        ]
        if len(candidates) == 1:
            return candidates[0]
        names = ", ".join(candidate.name for candidate in candidates) or "none"
        raise ManagedFileError(
            f"project is ambiguous; managed projects with state: {names}"
        )

    def _task_file(self, project_dir: Path, run_id: str | None) -> Path:
        run = _select_run(self._read_state(project_dir), run_id)
        recorded = run.get("task_file")
        if not isinstance(recorded, str) or not recorded:
            raise ManagedFileError(f"run {run.get('run_id')!r} has no task_file")
        project_root = self._filesystem.canonical(project_dir)
        task = self._filesystem.canonical(project_dir / recorded)
        if task != project_root and project_root not in task.parents:
            raise ManagedFileError(
                f"task_file escapes project control directory: {recorded!r}"
            )
        return self._require_file(task, "task file")

    def _read_state(self, project_dir: Path) -> dict[str, Any]:
        path = project_dir / "state.json"
        try:
            text = self._filesystem.read_text(path)
        except FileNotFoundError:
            raise ManagedFileError(
                f"no state.json for project {project_dir.name!r}"
            ) from None
        except OSError as error:
            raise ManagedFileError(f"cannot read {path}: {error}") from error
        try:
            document = json.loads(text)
        except json.JSONDecodeError as error:
            raise ManagedFileError(f"cannot read {path}: {error}") from error
        if not isinstance(document, dict) or not isinstance(document.get("runs"), list):
            raise ManagedFileError(f"invalid state structure in {path}")
        return document

    def _explicit_file(self, raw: str) -> Path:
        target = self._filesystem.canonical(Path(raw))
        if _is_sensitive(target.name):
            raise ManagedFileError(f"refusing to open sensitive file: {target.name}")
        return self._require_file(target, "file")

    def _require_file(self, path: Path, description: str) -> Path:
        canonical = self._filesystem.canonical(path)
        if not self._filesystem.is_file(canonical):
            raise ManagedFileError(f"{description} does not exist: {canonical}")
        return canonical


def _is_sensitive(basename: str) -> bool:
    """Known credential and private-key basenames, matched case-insensitively."""
    lowered = basename.lower()
    return lowered in SENSITIVE_BASENAMES or lowered.startswith(".env")


def _select_run(state: dict[str, Any], run_id: str | None) -> dict[str, Any]:
    runs = [run for run in state["runs"] if isinstance(run, dict)]
    if run_id:
        for run in runs:
            if run.get("run_id") == run_id:
                return run
        raise ManagedFileError(f"run {run_id!r} is not present in current state")
    active = [run for run in runs if run.get("status") in ACTIVE_STATUSES]
    pool = active or runs
    if not pool:
        raise ManagedFileError("project has no runs")
    return max(pool, key=_recency_key)


def _recency_key(run: Mapping[str, Any]) -> tuple[tuple[int, str], str]:
    return (_creation_key(run.get("created")), str(run.get("run_id", "")))


def _creation_key(value: object) -> tuple[int, str]:
    """Sort key that puts parseable ISO timestamps above unusable ones."""
    if not isinstance(value, str):
        return (0, "")
    try:
        return (1, datetime.fromisoformat(value).isoformat())
    except ValueError:
        return (0, value)
