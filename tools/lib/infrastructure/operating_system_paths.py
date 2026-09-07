"""Production path driver backed by the real filesystem."""

from __future__ import annotations

from pathlib import Path


class OperatingSystemPaths:
    """Production path driver that talks to the real OS filesystem."""

    def read_text(self, path: Path) -> str:
        return path.read_text(encoding="utf-8")

    def write_text(self, path: Path, text: str) -> None:
        path.write_text(text, encoding="utf-8")

    def is_file(self, path: Path) -> bool:
        return path.is_file()

    def is_dir(self, path: Path) -> bool:
        return path.is_dir()

    def child_names(self, path: Path) -> list[str]:
        if not path.is_dir():
            return []
        return sorted(child.name for child in path.iterdir())
