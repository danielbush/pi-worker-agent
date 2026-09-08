"""Tests for ManagedTarget names, aliases, and derived paths."""

from __future__ import annotations

from pathlib import Path

import pytest

from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.domain.managed_target import ManagedTarget, TargetScope

LEGACY_ALIASES = {
    "task": "task",
    "original-task": "task",
    "brief": "task",
    "original-brief": "task",
    "models": "models",
    "model": "models",
    "model-config": "models",
    "models.json": "models",
    "workflow": "workflows",
    "workflows": "workflows",
    "architecture": "architecture",
    "arch": "architecture",
    "policy": "policy",
    "agents": "policy",
    "manager-policy": "policy",
    "project": "project",
    "project-context": "project",
    "project-readme": "project",
    "state": "state",
    "state.json": "state",
    "tasks": "project-tasks",
    "project-tasks": "project-tasks",
    "project-index": "project-tasks",
    "root-tasks": "root-tasks",
    "root-index": "root-tasks",
}


@pytest.mark.parametrize(("alias", "canonical"), sorted(LEGACY_ALIASES.items()))
def test_every_published_alias_still_canonicalizes(alias: str, canonical: str) -> None:
    # arrange / act
    target = ManagedTarget.parse(alias)

    # assert
    assert target.canonical_name == canonical


def test_parse_normalizes_case_and_surrounding_space() -> None:
    # arrange / act
    target = ManagedTarget.parse("  Original-Brief ")

    # assert
    assert target is ManagedTarget.TASK


def test_unknown_target_reports_the_raw_name() -> None:
    # arrange / act
    with pytest.raises(ManagedFileError) as error:
        ManagedTarget.parse("secrets")

    # assert
    assert str(error.value) == "unknown target 'secrets'; use --list-targets"


def test_canonical_name_order_is_the_published_list_targets_order() -> None:
    # arrange / act
    names = ManagedTarget.canonical_names()

    # assert
    assert " ".join(names) == (
        "task models workflows architecture policy project state "
        "project-tasks root-tasks"
    )


def test_scopes_drive_project_and_run_applicability() -> None:
    # arrange / act / assert
    assert ManagedTarget.TASK.requires_project
    assert ManagedTarget.TASK.accepts_run_id
    assert ManagedTarget.STATE.requires_project
    assert not ManagedTarget.STATE.accepts_run_id
    assert not ManagedTarget.POLICY.requires_project
    assert not ManagedTarget.MODELS.accepts_run_id
    assert ManagedTarget.MODELS.scope is TargetScope.HOME
    assert ManagedTarget.POLICY.scope is TargetScope.REPOSITORY


def test_fixed_paths_hang_off_the_supplied_base() -> None:
    # arrange
    root = Path("/repo")
    home = Path("/home/agent")
    project = Path("/repo/projects/alpha")

    # act / assert
    assert ManagedTarget.MODELS.path_within(home) == home / ".prime/agent/models.json"
    assert ManagedTarget.WORKFLOWS.path_within(root) == root / "policies/WORKFLOWS.md"
    assert ManagedTarget.ARCHITECTURE.path_within(root) == root / "docs/ARCHITECTURE.md"
    assert ManagedTarget.POLICY.path_within(root) == root / "AGENTS.md"
    assert ManagedTarget.ROOT_TASKS.path_within(root) == root / "TASKS.md"
    assert ManagedTarget.PROJECT.path_within(project) == project / "README.md"
    assert ManagedTarget.STATE.path_within(project) == project / "state.json"
    assert ManagedTarget.PROJECT_TASKS.path_within(project) == project / "TASKS.md"


def test_task_target_has_no_fixed_path() -> None:
    # arrange / act
    with pytest.raises(ManagedFileError) as error:
        ManagedTarget.TASK.path_within(Path("/repo"))

    # assert
    assert "no fixed path" in str(error.value)
