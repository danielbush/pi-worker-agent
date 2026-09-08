"""Tests for EditorLauncher selection and launching over a null editor system."""

from __future__ import annotations

from pathlib import Path

import pytest

from tools.lib.show_managed_file.application.editor_launcher import EditorLauncher
from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.infrastructure.editor_system import EditorSystem

FILE = Path("/repo/AGENTS.md")
ALL_EDITORS = {
    "code": "/bin/code",
    "cursor": "/bin/cursor",
    "zed": "/bin/zed",
    "subl": "/bin/subl",
    "mate": "/bin/mate",
    "idea": "/bin/idea",
    "pycharm": "/bin/pycharm",
    "fleet": "/bin/fleet",
    "open": "/usr/bin/open",
}


@pytest.mark.parametrize(
    ("requested", "executable"),
    [
        ("code", "/bin/code"),
        ("VSCode", "/bin/code"),
        ("vscode", "/bin/code"),
        ("visual-studio-code", "/bin/code"),
        ("cursor", "/bin/cursor"),
        ("zed", "/bin/zed"),
        ("sublime", "/bin/subl"),
        ("Sublime Text", "/bin/subl"),
        ("subl", "/bin/subl"),
        ("textmate", "/bin/mate"),
        ("intellij", "/bin/idea"),
        ("pycharm", "/bin/pycharm"),
        ("fleet", "/bin/fleet"),
    ],
)
def test_named_editors_and_aliases_resolve_to_the_found_executable(
    requested: str, executable: str
) -> None:
    # arrange
    launcher = EditorLauncher(EditorSystem.create_null(executables=ALL_EDITORS))

    # act
    command = launcher.launch_command(FILE, requested, None)

    # assert
    assert command == [executable, "/repo/AGENTS.md"]


def test_unavailable_named_editor_is_reported() -> None:
    # arrange
    launcher = EditorLauncher(
        EditorSystem.create_null(executables={"code": "/bin/code"})
    )

    # act
    with pytest.raises(ManagedFileError) as error:
        launcher.launch_command(FILE, "zed", None)

    # assert
    assert str(error.value) == "GUI editor command is not available: 'zed'"


@pytest.mark.parametrize(
    "editor",
    [
        "vi",
        "vim",
        "nvim",
        "nano",
        "emacs",
        "emacsclient",
        "helix",
        "hx",
        "kak",
        "micro",
    ],
)
def test_terminal_editors_are_refused(editor: str) -> None:
    # arrange
    launcher = EditorLauncher(EditorSystem.create_null(executables=ALL_EDITORS))

    # act
    with pytest.raises(ManagedFileError) as error:
        launcher.launch_command(FILE, editor, None)

    # assert
    assert str(error.value) == (
        f"terminal editor {editor!r} is intentionally unsupported"
    )


def test_terminal_editor_is_refused_by_path_basename() -> None:
    # arrange
    launcher = EditorLauncher(EditorSystem.create_null(executables=ALL_EDITORS))

    # act
    with pytest.raises(ManagedFileError) as error:
        launcher.launch_command(FILE, "/usr/bin/VIM", None)

    # assert
    assert str(error.value) == "terminal editor 'vim' is intentionally unsupported"


@pytest.mark.parametrize(
    ("term_program", "executable"),
    [
        ("vscode", "/bin/code"),
        ("Cursor", "/bin/cursor"),
        ("cursor-nightly", "/bin/cursor"),
        ("zed", "/bin/zed"),
    ],
)
def test_terminal_program_signals_select_their_editor(
    term_program: str, executable: str
) -> None:
    # arrange
    launcher = EditorLauncher(
        EditorSystem.create_null(
            environment={"TERM_PROGRAM": term_program}, executables=ALL_EDITORS
        )
    )

    # act
    command = launcher.launch_command(FILE, None, None)

    # assert
    assert command == [executable, "/repo/AGENTS.md"]


def test_exactly_one_installed_gui_editor_is_used_without_a_signal() -> None:
    # arrange
    launcher = EditorLauncher(
        EditorSystem.create_null(executables={"subl": "/bin/subl"})
    )

    # act
    command = launcher.launch_command(FILE, None, None)

    # assert
    assert command == ["/bin/subl", "/repo/AGENTS.md"]


def test_several_installed_gui_editors_are_ambiguous() -> None:
    # arrange
    launcher = EditorLauncher(
        EditorSystem.create_null(
            executables={"code": "/bin/code", "zed": "/bin/zed"},
        )
    )

    # act
    with pytest.raises(ManagedFileError) as error:
        launcher.launch_command(FILE, None, None)

    # assert
    assert str(error.value) == (
        "GUI editor is ambiguous; pass --editor or --editor-app (available: code, zed)"
    )


def test_no_installed_gui_editor_is_ambiguous_with_none_detected() -> None:
    # arrange
    launcher = EditorLauncher(EditorSystem.create_null())

    # act
    with pytest.raises(ManagedFileError) as error:
        launcher.launch_command(FILE, None, None)

    # assert
    assert str(error.value) == (
        "GUI editor is ambiguous; pass --editor or --editor-app "
        "(available: none detected)"
    )


def test_macos_application_uses_open_dash_a() -> None:
    # arrange
    launcher = EditorLauncher(
        EditorSystem.create_null(executables={"open": "/usr/bin/open"}, macos=True)
    )

    # act
    command = launcher.launch_command(FILE, None, "Visual Studio Code")

    # assert
    assert command == ["open", "-a", "Visual Studio Code", "/repo/AGENTS.md"]


@pytest.mark.parametrize(
    ("macos", "executables"),
    [(False, {"open": "/usr/bin/open"}), (True, {})],
)
def test_macos_application_requires_macos_and_open(
    macos: bool, executables: dict[str, str]
) -> None:
    # arrange
    launcher = EditorLauncher(
        EditorSystem.create_null(executables=executables, macos=macos)
    )

    # act
    with pytest.raises(ManagedFileError) as error:
        launcher.launch_command(FILE, None, "Zed")

    # assert
    assert str(error.value) == "--editor-app requires the macOS `open` command"


def test_building_a_command_launches_nothing() -> None:
    # arrange
    editors = EditorSystem.create_null(executables=ALL_EDITORS)
    launcher = EditorLauncher(editors)

    # act
    launcher.launch_command(FILE, "code", None)

    # assert
    assert editors.launched_commands() == []


def test_launch_records_the_command_and_propagates_the_exit_status() -> None:
    # arrange
    editors = EditorSystem.create_null(executables=ALL_EDITORS, exit_code=7)
    launcher = EditorLauncher(editors)
    command = launcher.launch_command(FILE, "code", None)

    # act
    status = launcher.launch(command)

    # assert
    assert status == 7
    assert editors.launched_commands() == [["/bin/code", "/repo/AGENTS.md"]]
