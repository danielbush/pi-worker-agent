"""Dataclass model of one project's `state.json`."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar

from tools.lib.core.domain.run_record import RunRecord
from tools.lib.core.infrastructure.filesystem import Filesystem

SKIP_PROJECTS = frozenset({"example"})


def _archived_count(value: Any) -> int:
    return value if type(value) is int else 0


@dataclass(frozen=True)
class ProjectState:
    """Domain model of a project's `state.json`: name, path, runs, archived."""

    KNOWN_FIELDS: ClassVar[frozenset[str]] = frozenset(
        {"project", "path", "runs", "archived"}
    )

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
