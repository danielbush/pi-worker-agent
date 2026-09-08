"""INFRASTRUCTURE_WRAPPER for the filesystem facts this skill needs."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path

from tools.lib.show_managed_file.infrastructure._filesystem_driver import (
    EmbeddedPathStub,
    FilesystemDriver,
    OperatingSystemPaths,
)

NULL_HOME = "/home/agent"
NULL_WORKING_DIRECTORY = "/repo"


class Filesystem:
    """Home lookup, canonicalization, file reads, and directory inspection.

    The injected driver is private: consumers never learn whether they hold a
    production or null instance.
    """

    def __init__(self, driver: FilesystemDriver) -> None:
        self._driver = driver

    @staticmethod
    def create() -> Filesystem:
        return Filesystem(OperatingSystemPaths())

    @staticmethod
    def create_null(
        *,
        files: Mapping[str, str] | None = None,
        directories: Iterable[str] | None = None,
        home: str = NULL_HOME,
        working_directory: str = NULL_WORKING_DIRECTORY,
        links: Mapping[str, str] | None = None,
    ) -> Filesystem:
        return Filesystem(
            EmbeddedPathStub(
                files=files,
                directories=directories,
                home=home,
                working_directory=working_directory,
                links=links,
            )
        )

    def home(self) -> Path:
        return self._driver.home()

    def canonical(self, path: Path) -> Path:
        """Expand `~`, make absolute, and resolve `..` and symlinks."""
        return self._driver.canonical(path)

    def read_text(self, path: Path) -> str:
        return self._driver.read_text(path)

    def is_file(self, path: Path) -> bool:
        return self._driver.is_file(path)

    def is_dir(self, path: Path) -> bool:
        return self._driver.is_dir(path)

    def child_names(self, path: Path) -> list[str]:
        return self._driver.child_names(path)
