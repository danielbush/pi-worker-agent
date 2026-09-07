"""Dataclass model of one project's `state.json`."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tools.lib.infrastructure.filesystem import Filesystem

SKIP_PROJECTS = frozenset({"example"})


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


def _archived_count(value: Any) -> int:
    return value if type(value) is int else 0


@dataclass(frozen=True)
class RunRecord:
    """One run object from `state.json`, plus the owning project name."""

    project: str
    run_id: str | None = None
    title: str | None = None
    workflow: str | None = None
    status: str | None = None
    created: str | None = None
    task_file: str | None = None
    outcome: str | None = None
    jobs: list[Any] = field(default_factory=list)

    @classmethod
    def from_dict(cls, project: str, payload: Any) -> RunRecord | None:
        """Parse one run object; skip non-objects. Unknown fields are ignored."""
        if not isinstance(payload, dict):
            return None
        jobs = payload.get("jobs")
        return cls(
            project=project,
            run_id=_optional_str(payload.get("run_id")),
            title=_optional_str(payload.get("title")),
            workflow=_optional_str(payload.get("workflow")),
            status=_optional_str(payload.get("status")),
            created=_optional_str(payload.get("created")),
            task_file=_optional_str(payload.get("task_file")),
            outcome=_optional_str(payload.get("outcome")),
            jobs=list(jobs) if isinstance(jobs, list) else [],
        )


@dataclass(frozen=True)
class ProjectState:
    """Domain model of a project's `state.json`: name, path, runs, archived."""

    project: str
    path: str | None = None
    runs: list[RunRecord] = field(default_factory=list)
    archived: int = 0

    @classmethod
    def from_dict(cls, name: str, payload: Any) -> ProjectState:
        """Parse a state object; missing or wrong-typed fields get safe defaults."""
        if not isinstance(payload, dict):
            return cls(project=name)
        project = payload.get("project")
        if not isinstance(project, str) or not project:
            project = name
        path = payload.get("path")
        if not isinstance(path, str):
            path = None
        raw_runs = payload.get("runs") or []
        if not isinstance(raw_runs, list):
            raw_runs = []
        runs = [
            record
            for item in raw_runs
            if (record := RunRecord.from_dict(project, item))
        ]
        return cls(
            project=project,
            path=path,
            runs=runs,
            archived=_archived_count(payload.get("archived")),
        )

    @classmethod
    def from_json(cls, name: str, text: str) -> ProjectState:
        """Parse JSON text; invalid JSON becomes an empty project under `name`."""
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return cls(project=name)
        return cls.from_dict(name, payload)

    @classmethod
    def load(cls, state_path: Path, filesystem: Filesystem) -> ProjectState:
        name = state_path.parent.name
        try:
            return cls.from_json(name, filesystem.read_text(state_path))
        except OSError:
            return cls(project=name)

    @classmethod
    def discover(cls, projects_dir: Path, filesystem: Filesystem) -> list[ProjectState]:
        """Load each project under `projects/` except the reserved `example` folder."""
        if not filesystem.is_dir(projects_dir):
            return []
        states: list[ProjectState] = []
        for name in filesystem.child_names(projects_dir):
            child = projects_dir / name
            if not filesystem.is_dir(child) or name in SKIP_PROJECTS:
                continue
            state_path = child / "state.json"
            if filesystem.is_file(state_path):
                states.append(cls.load(state_path, filesystem))
        return states
