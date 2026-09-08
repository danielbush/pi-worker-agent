"""APPLICATION: choose a GUI editor, build its command, and launch it."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path

from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.infrastructure.editor_system import EditorSystem

TERMINAL_EDITORS = frozenset(
    {
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
    }
)
KNOWN_GUI_EDITORS = (
    "code",
    "cursor",
    "zed",
    "subl",
    "mate",
    "idea",
    "pycharm",
    "fleet",
)
EDITOR_ALIASES = {
    "vscode": "code",
    "visual-studio-code": "code",
    "sublime": "subl",
    "sublime-text": "subl",
    "textmate": "mate",
    "intellij": "idea",
}
TERMINAL_PROGRAM_EDITORS = (("cursor", "cursor"), ("vscode", "code"), ("zed", "zed"))


class EditorLauncher:
    """Own editor aliasing, terminal-editor refusal, detection, and launching.

    Building a command never launches anything, so `--dry-run` asks for a
    command and stops.
    """

    def __init__(self, editor_system: EditorSystem) -> None:
        self._editors = editor_system

    @staticmethod
    def create() -> EditorLauncher:
        return EditorLauncher(EditorSystem.create())

    @staticmethod
    def create_null(
        *,
        environment: Mapping[str, str] | None = None,
        executables: Mapping[str, str] | None = None,
        macos: bool = True,
        exit_code: int = 0,
    ) -> EditorLauncher:
        return EditorLauncher(
            EditorSystem.create_null(
                environment=environment,
                executables=executables,
                macos=macos,
                exit_code=exit_code,
            )
        )

    def launch_command(
        self, path: Path, editor: str | None, editor_app: str | None
    ) -> list[str]:
        """Build the full command that opens `path` in the selected editor."""
        return [*self._editor_prefix(editor, editor_app), str(path)]

    def launch(self, command: Sequence[str]) -> int:
        return self._editors.launch(command)

    def _editor_prefix(self, editor: str | None, editor_app: str | None) -> list[str]:
        if editor_app:
            return self._macos_application(editor_app)
        if editor:
            return self._named_editor(editor)
        return self._detected_editor()

    def _macos_application(self, editor_app: str) -> list[str]:
        if not self._editors.is_macos() or not self._editors.executable_path("open"):
            raise ManagedFileError("--editor-app requires the macOS `open` command")
        return ["open", "-a", editor_app]

    def _named_editor(self, editor: str) -> list[str]:
        normalized = editor.strip().lower().replace(" ", "-")
        command = EDITOR_ALIASES.get(normalized, editor.strip())
        basename = Path(command).name.lower()
        if basename in TERMINAL_EDITORS:
            raise ManagedFileError(
                f"terminal editor {basename!r} is intentionally unsupported"
            )
        executable = self._editors.executable_path(command)
        if not executable:
            raise ManagedFileError(f"GUI editor command is not available: {command!r}")
        return [executable]

    def _detected_editor(self) -> list[str]:
        term_program = self._editors.environment_value("TERM_PROGRAM").lower()
        for signal, command in TERMINAL_PROGRAM_EDITORS:
            if _matches_terminal_program(signal, term_program):
                executable = self._editors.executable_path(command)
                if executable:
                    return [executable]
        available = [
            name for name in KNOWN_GUI_EDITORS if self._editors.executable_path(name)
        ]
        if len(available) == 1:
            return [self._editors.executable_path(available[0]) or available[0]]
        choices = ", ".join(available) or "none detected"
        wanted = "pass --editor or --editor-app"
        raise ManagedFileError(
            f"GUI editor is ambiguous; {wanted} (available: {choices})"
        )


def _matches_terminal_program(signal: str, term_program: str) -> bool:
    """VS Code identifies itself exactly; Cursor and Zed use varied suffixes."""
    if signal == "vscode":
        return term_program == signal
    return signal in term_program
