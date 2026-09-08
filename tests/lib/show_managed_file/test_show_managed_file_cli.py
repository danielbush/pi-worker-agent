"""Tests for the CLI composition root: parsing, translation, and formatting.

These exercise argument translation and output formatting only. Resolution and
launching are covered by the null-infrastructure tests for their owners, so no
editor process is ever started here.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pytest

import show_managed_file
from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.domain.managed_target import ManagedTarget


def parse(argv: list[str]) -> argparse.Namespace:
    return show_managed_file.build_parser().parse_args(argv)


def test_list_targets_needs_no_target_or_editor(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # arrange / act
    status = show_managed_file.main(["--list-targets"])

    # assert
    assert status == 0
    assert capsys.readouterr().out == (
        "task models workflows architecture policy project state "
        "project-tasks root-tasks\n"
    )


def test_missing_target_and_file_uses_the_error_contract(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # arrange / act
    status = show_managed_file.main(["--editor", "code"])

    # assert
    assert status == 2
    assert capsys.readouterr().err == "error: either --target or --file is required\n"


def test_unknown_target_uses_the_error_contract(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # arrange / act
    status = show_managed_file.main(["--target", "secrets", "--editor", "code"])

    # assert
    assert status == 2
    assert capsys.readouterr().err == (
        "error: unknown target 'secrets'; use --list-targets\n"
    )


def test_parser_rejects_target_with_file() -> None:
    # arrange / act / assert
    with pytest.raises(SystemExit):
        parse(["--target", "policy", "--file", "/repo/AGENTS.md"])


def test_parser_rejects_editor_with_editor_app() -> None:
    # arrange / act / assert
    with pytest.raises(SystemExit):
        parse(["--editor", "code", "--editor-app", "Zed"])


def test_target_arguments_become_a_target_request() -> None:
    # arrange
    args = parse(["--root", "/repo", "--target", "brief", "--run-id", "r1"])

    # act
    request = show_managed_file.request_from(args)
    # assert
    assert request.root == Path("/repo")
    assert request.target is ManagedTarget.TASK
    assert request.run_id == "r1"


def test_file_arguments_become_a_file_request() -> None:
    # arrange
    args = parse(["--root", "/repo", "--file", "/repo/AGENTS.md", "--run-id", "r1"])

    # act
    request = show_managed_file.request_from(args)
    # assert
    assert request.explicit_file == "/repo/AGENTS.md"
    assert request.target is None
    assert request.run_id is None


def test_non_task_target_with_run_id_is_rejected() -> None:
    # arrange
    args = parse(["--target", "state", "--run-id", "r1"])

    # act / assert
    with pytest.raises(ManagedFileError):
        show_managed_file.request_from(args)


def test_dry_run_text_is_two_shell_quoted_lines() -> None:
    # arrange
    path = Path("/repo/my docs/AGENTS.md")

    # act
    text = show_managed_file.format_dry_run(path, ["/bin/code", str(path)])

    # assert
    assert text == (
        "file: /repo/my docs/AGENTS.md\ncommand: /bin/code '/repo/my docs/AGENTS.md'"
    )
