"""INFRASTRUCTURE_WRAPPER for path reads, writes, and directory listing."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from tools.lib.infrastructure.operating_system_paths import OperatingSystemPaths
from tools.lib.infrastructure.path_driver import PathDriver


class EmbeddedPathStub:
    """EMBEDDED_STUB that fakes path operations for Filesystem.create_null."""

    def __init__(
        self,
        files: dict[str, str] | None = None,
        directories: Iterable[str] | None = None,
        atomic_write_failures: Iterable[str] | None = None,
    ) -> None:
        self.files = {str(Path(key)): value for key, value in (files or {}).items()}
        self.directories = {str(Path(path)) for path in (directories or [])}
        self.atomic_write_failures = {
            str(Path(path)) for path in (atomic_write_failures or [])
        }
        for file_path in list(self.files):
            self.add_ancestors(Path(file_path))
        for directory in list(self.directories):
            self.add_ancestors(Path(directory))

    def read_text(self, path: Path) -> str:
        key = str(Path(path))
        if key not in self.files:
            raise OSError(key)
        return self.files[key]

    def write_text(self, path: Path, text: str) -> None:
        key = str(Path(path))
        self.files[key] = text
        self.add_ancestors(Path(key))

    def atomic_write_text(self, path: Path, text: str) -> None:
        key = str(Path(path))
        if key in self.atomic_write_failures:
            raise OSError(f"injected atomic write failure: {key}")
        self.write_text(path, text)

    def is_file(self, path: Path) -> bool:
        return str(Path(path)) in self.files

    def is_dir(self, path: Path) -> bool:
        return str(Path(path)) in self.directories

    def child_names(self, path: Path) -> list[str]:
        prefix = str(Path(path))
        names: set[str] = set()
        for key in set(self.files) | set(self.directories):
            child = Path(key)
            if str(child.parent) == prefix:
                names.add(child.name)
        return sorted(names)

    def add_ancestors(self, path: Path) -> None:
        """Record parent directories so listing and is_dir succeed after writes."""
        for ancestor in path.parents:
            self.directories.add(str(ancestor))
        if str(path) not in self.files:
            self.directories.add(str(path))


class Filesystem:
    """INFRASTRUCTURE_WRAPPER for path reads, writes, and directory listing.

    Injected PathDriver is private; consumers never choose production vs null.
    """

    def __init__(self, driver: PathDriver) -> None:
        self.driver = driver

    @staticmethod
    def create() -> Filesystem:
        return Filesystem(OperatingSystemPaths())

    @staticmethod
    def create_null(
        *,
        files: dict[str, str] | None = None,
        directories: Iterable[str] | None = None,
        atomic_write_failures: Iterable[str] | None = None,
    ) -> Filesystem:
        return Filesystem(
            EmbeddedPathStub(
                files=files,
                directories=directories,
                atomic_write_failures=atomic_write_failures,
            )
        )

    def read_text(self, path: Path) -> str:
        return self.driver.read_text(path)

    def write_text(self, path: Path, text: str) -> None:
        self.driver.write_text(path, text)

    def atomic_write_text(self, path: Path, text: str) -> None:
        self.driver.atomic_write_text(path, text)

    def is_file(self, path: Path) -> bool:
        return self.driver.is_file(path)

    def is_dir(self, path: Path) -> bool:
        return self.driver.is_dir(path)

    def child_names(self, path: Path) -> list[str]:
        return self.driver.child_names(path)
