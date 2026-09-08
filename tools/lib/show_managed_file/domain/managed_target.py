"""DOMAIN: the authoritative files this skill can name, alias, and locate."""

from __future__ import annotations

from enum import Enum
from pathlib import Path

from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError


class TargetScope(Enum):
    """Which base path a target's fixed relative path hangs off."""

    HOME = "home"
    REPOSITORY = "repository"
    PROJECT = "project"
    TASK = "task"


class ManagedTarget(Enum):
    """One managed file, owning its canonical name, aliases, and derived path.

    Declaration order is the published `--list-targets` order. Callers ask this
    enum for names, aliases, and paths instead of rebuilding target tables.
    """

    TASK = (
        "task",
        TargetScope.TASK,
        None,
        "task file",
        ("original-task", "brief", "original-brief"),
    )
    MODELS = (
        "models",
        TargetScope.HOME,
        ".prime/agent/models.json",
        "model configuration",
        ("model", "model-config", "models.json"),
    )
    WORKFLOWS = (
        "workflows",
        TargetScope.REPOSITORY,
        "policies/WORKFLOWS.md",
        "workflow configuration",
        ("workflow",),
    )
    ARCHITECTURE = (
        "architecture",
        TargetScope.REPOSITORY,
        "docs/ARCHITECTURE.md",
        "architecture document",
        ("arch",),
    )
    POLICY = (
        "policy",
        TargetScope.REPOSITORY,
        "AGENTS.md",
        "manager policy",
        ("agents", "manager-policy"),
    )
    PROJECT = (
        "project",
        TargetScope.PROJECT,
        "README.md",
        "project file",
        ("project-context", "project-readme"),
    )
    STATE = ("state", TargetScope.PROJECT, "state.json", "state file", ("state.json",))
    PROJECT_TASKS = (
        "project-tasks",
        TargetScope.PROJECT,
        "TASKS.md",
        "project-tasks file",
        ("tasks", "project-index"),
    )
    ROOT_TASKS = (
        "root-tasks",
        TargetScope.REPOSITORY,
        "TASKS.md",
        "root task index",
        ("root-index",),
    )

    def __init__(
        self,
        canonical_name: str,
        scope: TargetScope,
        relative_path: str | None,
        description: str,
        extra_aliases: tuple[str, ...],
    ) -> None:
        self.canonical_name = canonical_name
        self.scope = scope
        self.relative_path = relative_path
        self.description = description
        self.aliases = (canonical_name, *extra_aliases)

    @classmethod
    def parse(cls, raw: str) -> ManagedTarget:
        """Resolve a user-supplied name or alias to its canonical target."""
        normalized = raw.strip().lower()
        for target in cls:
            if normalized in target.aliases:
                return target
        raise ManagedFileError(f"unknown target {raw!r}; use --list-targets")

    @classmethod
    def canonical_names(cls) -> tuple[str, ...]:
        return tuple(target.canonical_name for target in cls)

    @property
    def requires_project(self) -> bool:
        return self.scope in (TargetScope.PROJECT, TargetScope.TASK)

    @property
    def accepts_run_id(self) -> bool:
        return self.scope is TargetScope.TASK

    def path_within(self, base: Path) -> Path:
        """Return this target's fixed path under the base its scope names."""
        if self.relative_path is None:
            raise ManagedFileError(f"target {self.canonical_name!r} has no fixed path")
        return base / self.relative_path
