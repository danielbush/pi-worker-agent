"""INFRASTRUCTURE_WRAPPER for editor discovery and process launching."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from tools.lib.show_managed_file.infrastructure._editor_system_driver import (
    EditorSystemDriver,
    EmbeddedEditorStub,
    OperatingSystemEditors,
)


class EditorSystem:
    """Environment values, platform, executable lookup, and one process launch.

    Launched commands are recorded so tests assert on wrapper state rather than
    on interactions with a driver. `subprocess` values never escape this class.
    """

    def __init__(self, driver: EditorSystemDriver) -> None:
        self._driver = driver
        self._launched: list[list[str]] = []

    @staticmethod
    def create() -> EditorSystem:
        return EditorSystem(OperatingSystemEditors())

    @staticmethod
    def create_null(
        *,
        environment: Mapping[str, str] | None = None,
        executables: Mapping[str, str] | None = None,
        macos: bool = True,
        exit_code: int = 0,
    ) -> EditorSystem:
        return EditorSystem(
            EmbeddedEditorStub(
                environment=environment,
                executables=executables,
                macos=macos,
                exit_code=exit_code,
            )
        )

    def environment_value(self, name: str) -> str:
        return self._driver.environment_value(name)

    def is_macos(self) -> bool:
        return self._driver.is_macos()

    def executable_path(self, command: str) -> str | None:
        return self._driver.executable_path(command)

    def launch(self, command: Sequence[str]) -> int:
        launched = list(command)
        self._launched.append(launched)
        return self._driver.run(launched)

    def launched_commands(self) -> list[list[str]]:
        """Snapshot of every command launched through this wrapper."""
        return [list(command) for command in self._launched]
