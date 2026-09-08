"""Tests for the EditorSystem wrapper and its null variant."""

from __future__ import annotations

from tools.lib.show_managed_file.infrastructure.editor_system import EditorSystem


def test_null_editor_system_serves_configured_environment_facts() -> None:
    # arrange
    editors = EditorSystem.create_null(
        environment={"TERM_PROGRAM": "vscode"},
        executables={"code": "/usr/local/bin/code"},
        macos=False,
    )

    # act / assert
    assert editors.environment_value("TERM_PROGRAM") == "vscode"
    assert editors.environment_value("EDITOR") == ""
    assert editors.executable_path("code") == "/usr/local/bin/code"
    assert editors.executable_path("zed") is None
    assert editors.is_macos() is False


def test_launch_records_the_command_and_returns_the_configured_status() -> None:
    # arrange
    editors = EditorSystem.create_null(exit_code=3)

    # act
    status = editors.launch(["/usr/local/bin/code", "/repo/AGENTS.md"])

    # assert
    assert status == 3
    assert editors.launched_commands() == [["/usr/local/bin/code", "/repo/AGENTS.md"]]


def test_launched_commands_returns_a_detached_snapshot() -> None:
    # arrange
    editors = EditorSystem.create_null()
    editors.launch(["/usr/local/bin/code", "/repo/AGENTS.md"])

    # act
    snapshot = editors.launched_commands()
    snapshot[0].append("/repo/TASKS.md")

    # assert
    assert editors.launched_commands() == [["/usr/local/bin/code", "/repo/AGENTS.md"]]


def test_a_fresh_system_has_launched_nothing() -> None:
    # arrange
    editors = EditorSystem.create_null()

    # act / assert
    assert editors.launched_commands() == []
