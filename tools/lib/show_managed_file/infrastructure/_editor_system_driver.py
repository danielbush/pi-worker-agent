"""Private DRIVER_CODE for EditorSystem: real environment/process and a stub."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Mapping, Sequence
from typing import Protocol


class EditorSystemDriver(Protocol):
    """Driver contract shared by the production system and the embedded stub."""

    def environment_value(self, name: str) -> str: ...
    def is_macos(self) -> bool: ...
    def executable_path(self, command: str) -> str | None: ...
    def run(self, command: Sequence[str]) -> int: ...


class OperatingSystemEditors:
    """Production driver over `os.environ`, `sys.platform`, `shutil`, `subprocess`."""

    def environment_value(self, name: str) -> str:
        return os.environ.get(name, "")

    def is_macos(self) -> bool:
        return sys.platform == "darwin"

    def executable_path(self, command: str) -> str | None:
        return shutil.which(command)

    def run(self, command: Sequence[str]) -> int:
        return subprocess.run(list(command), check=False).returncode


class EmbeddedEditorStub:
    """EMBEDDED_STUB: configured environment, platform, executables, exit code."""

    def __init__(
        self,
        *,
        environment: Mapping[str, str] | None = None,
        executables: Mapping[str, str] | None = None,
        macos: bool,
        exit_code: int,
    ) -> None:
        self._environment = dict(environment or {})
        self._executables = dict(executables or {})
        self._macos = macos
        self._exit_code = exit_code

    def environment_value(self, name: str) -> str:
        return self._environment.get(name, "")

    def is_macos(self) -> bool:
        return self._macos

    def executable_path(self, command: str) -> str | None:
        return self._executables.get(command)

    def run(self, command: Sequence[str]) -> int:
        return self._exit_code
