"""Tests for ManagedFileRequest construction rules."""

from __future__ import annotations

from pathlib import Path

import pytest

from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.domain.managed_file_request import ManagedFileRequest
from tools.lib.show_managed_file.domain.managed_target import ManagedTarget

ROOT = Path("/repo")


def test_target_request_carries_normalized_intent() -> None:
    # arrange / act
    request = ManagedFileRequest.for_target(
        ROOT, "Brief", project="alpha", run_id="2026-09-08-0912-build"
    )

    # assert
    assert request.target is ManagedTarget.TASK
    assert request.project == "alpha"
    assert request.run_id == "2026-09-08-0912-build"
    assert request.explicit_file is None


def test_file_request_ignores_project_and_run_selection() -> None:
    # arrange / act
    request = ManagedFileRequest.for_file(ROOT, "/repo/AGENTS.md")

    # assert
    assert request.explicit_file == "/repo/AGENTS.md"
    assert request.target is None
    assert request.project is None
    assert request.run_id is None


def test_target_and_file_are_mutually_exclusive() -> None:
    # arrange / act
    with pytest.raises(ManagedFileError) as error:
        ManagedFileRequest(
            root=ROOT, target=ManagedTarget.POLICY, explicit_file="/repo/AGENTS.md"
        )

    # assert
    assert str(error.value) == "--target and --file are mutually exclusive"


def test_neither_target_nor_file_is_rejected() -> None:
    # arrange / act
    with pytest.raises(ManagedFileError) as error:
        ManagedFileRequest(root=ROOT)

    # assert
    assert str(error.value) == "either --target or --file is required"


def test_run_id_is_rejected_for_non_task_targets() -> None:
    # arrange / act
    with pytest.raises(ManagedFileError) as error:
        ManagedFileRequest.for_target(ROOT, "state", run_id="2026-09-08-0912-build")

    # assert
    assert str(error.value) == "--run-id is valid only for the task target"


def test_run_id_is_accepted_for_the_task_target() -> None:
    # arrange / act
    request = ManagedFileRequest.for_target(ROOT, "task", run_id="r1")

    # assert
    assert request.run_id == "r1"
