"""Private DRIVER_CODE for Filesystem: real paths and an in-memory stub."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Protocol

MAX_LINK_HOPS = 16


class FilesystemDriver(Protocol):
    """Driver contract shared by the production paths and the embedded stub."""

    def home(self) -> Path: ...
    def canonical(self, path: Path) -> Path: ...
    def read_text(self, path: Path) -> str: ...
    def is_file(self, path: Path) -> bool: ...
    def is_dir(self, path: Path) -> bool: ...
    def child_names(self, path: Path) -> list[str]: ...


class OperatingSystemPaths:
    """Production driver over `pathlib.Path`."""

    def home(self) -> Path:
        return Path.home()

    def canonical(self, path: Path) -> Path:
        return path.expanduser().resolve()

    def read_text(self, path: Path) -> str:
        return path.read_text(encoding="utf-8")

    def is_file(self, path: Path) -> bool:
        return path.is_file()

    def is_dir(self, path: Path) -> bool:
        return path.is_dir()

    def child_names(self, path: Path) -> list[str]:
        try:
            return sorted(entry.name for entry in path.iterdir())
        except OSError:
            return []


class EmbeddedPathStub:
    """EMBEDDED_STUB: an in-memory tree with a home, a cwd, and symlinks.

    Canonicalization mirrors production `expanduser().resolve()` closely enough
    to exercise containment: `~` expansion, absolute-isation against the
    configured working directory, `.`/`..` normalization, then link following.
    """

    def __init__(
        self,
        *,
        files: Mapping[str, str] | None = None,
        directories: Iterable[str] | None = None,
        home: str,
        working_directory: str,
        links: Mapping[str, str] | None = None,
    ) -> None:
        self.files = {str(Path(key)): value for key, value in (files or {}).items()}
        self.directories = {str(Path(path)) for path in (directories or [])}
        self._home = Path(home)
        self._working_directory = Path(working_directory)
        self._links = sorted(
            (
                (Path(source), Path(destination))
                for source, destination in (links or {}).items()
            ),
            key=lambda pair: len(pair[0].parts),
            reverse=True,
        )
        for known in [*self.files, *list(self.directories)]:
            self._add_ancestors(Path(known))

    def home(self) -> Path:
        return self._home

    def canonical(self, path: Path) -> Path:
        expanded = self._expand_user(path)
        if not expanded.is_absolute():
            expanded = self._working_directory / expanded
        resolved = _normalize(expanded)
        for _ in range(MAX_LINK_HOPS):
            followed = self._follow_links(resolved)
            if followed == resolved:
                return resolved
            resolved = _normalize(followed)
        raise OSError(f"too many levels of symbolic links: {path}")

    def read_text(self, path: Path) -> str:
        key = str(Path(path))
        if key not in self.files:
            raise FileNotFoundError(key)
        return self.files[key]

    def is_file(self, path: Path) -> bool:
        return str(Path(path)) in self.files

    def is_dir(self, path: Path) -> bool:
        return str(Path(path)) in self.directories

    def child_names(self, path: Path) -> list[str]:
        prefix = str(Path(path))
        names: set[str] = set()
        for key in set(self.files) | self.directories:
            child = Path(key)
            if str(child.parent) == prefix:
                names.add(child.name)
        return sorted(names)

    def _expand_user(self, path: Path) -> Path:
        parts = path.parts
        if not parts or parts[0] != "~":
            return path
        return self._home.joinpath(*parts[1:])

    def _follow_links(self, path: Path) -> Path:
        for source, destination in self._links:
            if path == source:
                return destination
            if source in path.parents:
                return destination / path.relative_to(source)
        return path

    def _add_ancestors(self, path: Path) -> None:
        """Record parent directories so is_dir and child_names behave."""
        for ancestor in path.parents:
            self.directories.add(str(ancestor))
        if str(path) not in self.files:
            self.directories.add(str(path))


def _normalize(path: Path) -> Path:
    """Collapse `.` and `..` lexically, as `resolve()` does for real paths."""
    anchor = path.anchor or "/"
    parts: list[str] = []
    for part in path.parts[1:] if path.anchor else path.parts:
        if part == ".":
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return Path(anchor).joinpath(*parts)
