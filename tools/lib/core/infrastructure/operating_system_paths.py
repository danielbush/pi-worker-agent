"""Production path driver backed by the real filesystem."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


class OperatingSystemPaths:
    """Production path driver that talks to the real OS filesystem."""

    def read_text(self, path: Path) -> str:
        return path.read_text(encoding="utf-8")

    def write_text(self, path: Path, text: str) -> None:
        path.write_text(text, encoding="utf-8")

    def atomic_write_text(self, path: Path, text: str) -> None:
        """Replace one text file atomically after flushing its temporary file."""
        descriptor, temporary_name = tempfile.mkstemp(
            dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
                temporary.write(text)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, path)
            self._sync_directory(path.parent)
        except BaseException:
            temporary_path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _sync_directory(directory: Path) -> None:
        """Best-effort durability for the directory entry created by replace."""
        try:
            descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        except OSError:
            return
        try:
            os.fsync(descriptor)
        except OSError:
            pass
        finally:
            os.close(descriptor)

    def append_text(self, path: Path, text: str) -> None:
        """Append text to a file, creating it when missing (durable append)."""
        with path.open("a", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())

    def is_file(self, path: Path) -> bool:
        return path.is_file()

    def is_dir(self, path: Path) -> bool:
        return path.is_dir()

    def child_names(self, path: Path) -> list[str]:
        if not path.is_dir():
            return []
        return sorted(child.name for child in path.iterdir())
