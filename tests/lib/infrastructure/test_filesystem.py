"""Tests for Filesystem and the public EmbeddedPathStub."""

from __future__ import annotations

from pathlib import Path

from tools.lib.infrastructure.filesystem import EmbeddedPathStub, Filesystem


def test_stub_is_importable_and_drives_filesystem() -> None:
    # arrange
    stub = EmbeddedPathStub(
        files={"/repo/projects/alpha/state.json": '{"runs": []}'},
    )
    filesystem = Filesystem(stub)

    # act
    names = filesystem.child_names(Path("/repo/projects"))
    text = filesystem.read_text(Path("/repo/projects/alpha/state.json"))
    filesystem.write_text(Path("/repo/TASKS.md"), "# Tasks\n")

    # assert
    assert names == ["alpha"]
    assert text == '{"runs": []}'
    assert filesystem.is_file(Path("/repo/TASKS.md"))
    assert stub.files["/repo/TASKS.md"] == "# Tasks\n"
    assert isinstance(filesystem.driver, EmbeddedPathStub)


def test_atomic_write_failure_preserves_existing_text() -> None:
    # arrange
    path = Path("/repo/state.json")
    filesystem = Filesystem.create_null(
        files={str(path): "old\n"}, atomic_write_failures=[str(path)]
    )

    # act
    try:
        filesystem.atomic_write_text(path, "new\n")
    except OSError as error:
        message = str(error)
    else:
        raise AssertionError("expected injected failure")

    # assert
    assert str(path) in message
    assert filesystem.read_text(path) == "old\n"
