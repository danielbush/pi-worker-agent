"""Tests for the show-managed-file Filesystem wrapper and its null variant.

Named `..._wrapper` because pytest requires unique test module basenames across
the non-package `tests/` tree, and `tests/lib/infrastructure/test_filesystem.py`
already exists.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tools.lib.show_managed_file.infrastructure.filesystem import Filesystem


def test_null_filesystem_serves_files_directories_and_home() -> None:
    # arrange
    filesystem = Filesystem.create_null(
        files={"/repo/projects/alpha/state.json": '{"runs": []}'},
        home="/home/agent",
    )

    # act
    text = filesystem.read_text(Path("/repo/projects/alpha/state.json"))

    # assert
    assert text == '{"runs": []}'
    assert filesystem.is_file(Path("/repo/projects/alpha/state.json"))
    assert filesystem.is_dir(Path("/repo/projects/alpha"))
    assert filesystem.child_names(Path("/repo/projects")) == ["alpha"]
    assert filesystem.home() == Path("/home/agent")


def test_missing_file_read_raises_file_not_found() -> None:
    # arrange
    filesystem = Filesystem.create_null()

    # act / assert
    with pytest.raises(FileNotFoundError):
        filesystem.read_text(Path("/repo/missing.json"))


def test_canonical_expands_home_relative_paths_and_parents() -> None:
    # arrange
    filesystem = Filesystem.create_null(
        home="/home/agent", working_directory="/repo/work"
    )

    # act / assert
    assert filesystem.canonical(Path("~/.prime/agent/models.json")) == Path(
        "/home/agent/.prime/agent/models.json"
    )
    assert filesystem.canonical(Path("notes.md")) == Path("/repo/work/notes.md")
    assert filesystem.canonical(Path("/repo/a/../b/./c")) == Path("/repo/b/c")


def test_canonical_follows_configured_links() -> None:
    # arrange
    filesystem = Filesystem.create_null(links={"/repo/projects/alpha/out": "/etc"})

    # act
    escaped = filesystem.canonical(Path("/repo/projects/alpha/out/passwd"))

    # assert
    assert escaped == Path("/etc/passwd")


def test_child_names_of_an_unknown_directory_is_empty() -> None:
    # arrange
    filesystem = Filesystem.create_null()

    # act / assert
    assert filesystem.child_names(Path("/repo/projects")) == []
