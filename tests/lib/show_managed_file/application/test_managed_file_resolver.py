"""Tests for ManagedFileResolver over a null filesystem."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tools.lib.show_managed_file.application.managed_file_resolver import (
    ManagedFileResolver,
)
from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.domain.managed_file_request import ManagedFileRequest
from tools.lib.show_managed_file.infrastructure.filesystem import Filesystem

ROOT = Path("/repo")
HOME = "/home/agent"


def state(*runs: dict[str, Any]) -> str:
    return json.dumps({"project": "alpha", "runs": list(runs)})


def run(
    run_id: str,
    *,
    status: str = "running",
    created: str = "2026-09-08T09:12:00+10:00",
    task_file: str | None = "runs/current/00-task.md",
) -> dict[str, Any]:
    record: dict[str, Any] = {"run_id": run_id, "status": status, "created": created}
    if task_file is not None:
        record["task_file"] = task_file
    return record


def repository_files(**extra: str) -> dict[str, str]:
    files = {
        "/repo/AGENTS.md": "policy\n",
        "/repo/TASKS.md": "root index\n",
        "/repo/policies/WORKFLOWS.md": "workflows\n",
        "/repo/docs/ARCHITECTURE.md": "architecture\n",
        "/home/agent/.prime/agent/models.json": "{}\n",
        "/repo/projects/alpha/README.md": "context\n",
        "/repo/projects/alpha/TASKS.md": "project index\n",
        "/repo/projects/alpha/state.json": state(run("2026-09-08-0912-build")),
        "/repo/projects/alpha/runs/current/00-task.md": "task\n",
    }
    files.update(extra)
    return files


def resolver(
    files: dict[str, str] | None = None,
    *,
    links: dict[str, str] | None = None,
) -> ManagedFileResolver:
    return ManagedFileResolver(
        Filesystem.create_null(
            files=repository_files() if files is None else files,
            home=HOME,
            working_directory="/repo",
            links=links,
        )
    )


def resolve_target(
    subject: ManagedFileResolver,
    target: str,
    *,
    project: str | None = None,
    run_id: str | None = None,
) -> Path:
    return subject.resolve(
        ManagedFileRequest.for_target(ROOT, target, project=project, run_id=run_id)
    )


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        ("policy", "/repo/AGENTS.md"),
        ("root-tasks", "/repo/TASKS.md"),
        ("workflows", "/repo/policies/WORKFLOWS.md"),
        ("architecture", "/repo/docs/ARCHITECTURE.md"),
        ("models", "/home/agent/.prime/agent/models.json"),
        ("project", "/repo/projects/alpha/README.md"),
        ("state", "/repo/projects/alpha/state.json"),
        ("project-tasks", "/repo/projects/alpha/TASKS.md"),
        ("task", "/repo/projects/alpha/runs/current/00-task.md"),
    ],
)
def test_each_target_resolves_to_its_authoritative_path(
    target: str, expected: str
) -> None:
    # arrange
    subject = resolver()

    # act
    path = resolve_target(subject, target)

    # assert
    assert path == Path(expected)


def test_repository_targets_do_not_need_an_unambiguous_project() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/beta/state.json"] = state()

    # act
    path = resolve_target(resolver(files), "policy")

    # assert
    assert path == Path("/repo/AGENTS.md")


def test_named_project_is_selected() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/beta/state.json"] = state()
    files["/repo/projects/beta/README.md"] = "beta\n"

    # act
    path = resolve_target(resolver(files), "project", project="beta")

    # assert
    assert path == Path("/repo/projects/beta/README.md")


def test_unsafe_project_name_is_refused() -> None:
    # arrange
    subject = resolver()

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(subject, "project", project="../secrets")

    # assert
    assert str(error.value) == "unsafe project name: '../secrets'"


def test_missing_named_project_is_reported() -> None:
    # arrange
    subject = resolver()

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(subject, "project", project="gamma")

    # assert
    assert str(error.value) == "managed project 'gamma' does not exist"


def test_several_projects_with_state_are_ambiguous() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/beta/state.json"] = state()

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "project")

    # assert
    assert (
        str(error.value)
        == "project is ambiguous; managed projects with state: alpha, beta"
    )


def test_no_project_with_state_is_ambiguous_with_none_listed() -> None:
    # arrange
    subject = resolver({"/repo/AGENTS.md": "policy\n"})

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(subject, "project")

    # assert
    assert str(error.value) == "project is ambiguous; managed projects with state: none"


def test_named_run_wins_over_the_newest_active_run() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state(
        run("older", created="2026-09-01T09:00:00+10:00", task_file="runs/old/00.md"),
        run("newer", created="2026-09-08T09:00:00+10:00"),
    )
    files["/repo/projects/alpha/runs/old/00.md"] = "old task\n"

    # act
    path = resolve_target(resolver(files), "task", run_id="older")

    # assert
    assert path == Path("/repo/projects/alpha/runs/old/00.md")


def test_unknown_run_id_is_reported() -> None:
    # arrange
    subject = resolver()

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(subject, "task", run_id="missing")

    # assert
    assert str(error.value) == "run 'missing' is not present in current state"


def test_newest_active_run_is_selected_by_creation_time() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state(
        run("a", created="2026-09-08T09:00:00+10:00", task_file="runs/a/00.md"),
        run("b", created="2026-09-08T11:00:00+10:00", task_file="runs/b/00.md"),
        run(
            "c",
            status="done",
            created="2026-09-09T09:00:00+10:00",
            task_file="runs/c/00.md",
        ),
    )
    files["/repo/projects/alpha/runs/a/00.md"] = "a\n"
    files["/repo/projects/alpha/runs/b/00.md"] = "b\n"
    files["/repo/projects/alpha/runs/c/00.md"] = "c\n"

    # act
    path = resolve_target(resolver(files), "task")

    # assert
    assert path == Path("/repo/projects/alpha/runs/b/00.md")


def test_equal_creation_times_break_the_tie_on_run_id() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state(
        run("run-b", created="2026-09-08T09:00:00+10:00", task_file="runs/b/00.md"),
        run("run-a", created="2026-09-08T09:00:00+10:00", task_file="runs/a/00.md"),
    )
    files["/repo/projects/alpha/runs/a/00.md"] = "a\n"
    files["/repo/projects/alpha/runs/b/00.md"] = "b\n"

    # act
    path = resolve_target(resolver(files), "task")

    # assert
    assert path == Path("/repo/projects/alpha/runs/b/00.md")


def test_without_an_active_run_the_newest_run_is_used() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state(
        run(
            "old",
            status="done",
            created="2026-09-01T09:00:00+10:00",
            task_file="runs/old/00.md",
        ),
        run(
            "new",
            status="failed",
            created="2026-09-08T09:00:00+10:00",
            task_file="runs/new/00.md",
        ),
    )
    files["/repo/projects/alpha/runs/old/00.md"] = "old\n"
    files["/repo/projects/alpha/runs/new/00.md"] = "new\n"

    # act
    path = resolve_target(resolver(files), "task")

    # assert
    assert path == Path("/repo/projects/alpha/runs/new/00.md")


def test_project_without_runs_is_reported() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state()

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "task")

    # assert
    assert str(error.value) == "project has no runs"


def test_run_without_a_task_file_is_reported() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state(run("solo", task_file=None))

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "task")

    # assert
    assert str(error.value) == "run 'solo' has no task_file"


@pytest.mark.parametrize(
    "task_file",
    ["../../../etc/passwd", "/etc/passwd"],
)
def test_task_file_escaping_the_project_is_refused(task_file: str) -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state(run("solo", task_file=task_file))
    files["/etc/passwd"] = "root\n"

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "task")

    # assert
    assert str(error.value) == (
        f"task_file escapes project control directory: {task_file!r}"
    )


def test_task_file_escaping_through_a_symlink_is_refused() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state(
        run("solo", task_file="outside/00-task.md")
    )
    files["/elsewhere/00-task.md"] = "task\n"
    subject = resolver(files, links={"/repo/projects/alpha/outside": "/elsewhere"})

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(subject, "task")

    # assert
    assert "escapes project control directory" in str(error.value)


def test_missing_task_file_on_disk_is_reported() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = state(
        run("solo", task_file="runs/gone/00-task.md")
    )

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "task")

    # assert
    assert str(error.value) == (
        "task file does not exist: /repo/projects/alpha/runs/gone/00-task.md"
    )


def test_missing_managed_target_file_is_reported() -> None:
    # arrange
    files = repository_files()
    del files["/repo/docs/ARCHITECTURE.md"]

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "architecture")

    # assert
    assert str(error.value) == (
        "architecture document does not exist: /repo/docs/ARCHITECTURE.md"
    )


def test_missing_state_file_is_reported() -> None:
    # arrange
    files = repository_files()
    del files["/repo/projects/alpha/state.json"]

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "task", project="alpha")

    # assert
    assert str(error.value) == "no state.json for project 'alpha'"


def test_unparseable_state_is_reported() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = "{not json"

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "task")

    # assert
    assert str(error.value).startswith("cannot read /repo/projects/alpha/state.json:")


def test_state_without_a_runs_list_is_reported() -> None:
    # arrange
    files = repository_files()
    files["/repo/projects/alpha/state.json"] = json.dumps({"project": "alpha"})

    # act
    with pytest.raises(ManagedFileError) as error:
        resolve_target(resolver(files), "task")

    # assert
    assert str(error.value) == (
        "invalid state structure in /repo/projects/alpha/state.json"
    )


def test_explicit_nonsensitive_file_is_allowed() -> None:
    # arrange
    subject = resolver()

    # act
    path = subject.resolve(ManagedFileRequest.for_file(ROOT, "/repo/AGENTS.md"))

    # assert
    assert path == Path("/repo/AGENTS.md")


def test_explicit_relative_file_is_canonicalized() -> None:
    # arrange
    subject = resolver()

    # act
    path = subject.resolve(ManagedFileRequest.for_file(ROOT, "docs/../AGENTS.md"))

    # assert
    assert path == Path("/repo/AGENTS.md")


@pytest.mark.parametrize(
    "name",
    [
        "auth.json",
        "AUTH.JSON",
        ".env",
        ".env.local",
        ".ENV.PRODUCTION",
        "credentials.json",
        "id_rsa",
        "id_ed25519",
    ],
)
def test_explicit_sensitive_files_are_refused(name: str) -> None:
    # arrange
    files = repository_files()
    files[f"/repo/{name}"] = "secret\n"

    # act
    with pytest.raises(ManagedFileError) as error:
        resolver(files).resolve(ManagedFileRequest.for_file(ROOT, f"/repo/{name}"))

    # assert
    assert str(error.value) == f"refusing to open sensitive file: {name}"


def test_missing_explicit_file_is_reported() -> None:
    # arrange
    subject = resolver()

    # act
    with pytest.raises(ManagedFileError) as error:
        subject.resolve(ManagedFileRequest.for_file(ROOT, "/repo/nowhere.md"))

    # assert
    assert str(error.value) == "file does not exist: /repo/nowhere.md"


def test_root_is_canonicalized_before_target_resolution() -> None:
    # arrange
    subject = resolver()

    # act
    path = subject.resolve(
        ManagedFileRequest.for_target(Path("/repo/docs/.."), "policy")
    )

    # assert
    assert path == Path("/repo/AGENTS.md")
