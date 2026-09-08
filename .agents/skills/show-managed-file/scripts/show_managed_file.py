#!/usr/bin/env python3
"""Resolve an authoritative Prime Worker Agent file and open it in a GUI editor."""

from __future__ import annotations

import argparse
import shlex
import sys
from collections.abc import Sequence
from pathlib import Path

import _bootstrap  # noqa: F401  (puts the repository root on `sys.path`)
from tools.lib.show_managed_file.application.editor_launcher import EditorLauncher
from tools.lib.show_managed_file.application.managed_file_resolver import (
    ManagedFileResolver,
)
from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.domain.managed_file_request import ManagedFileRequest
from tools.lib.show_managed_file.domain.managed_target import ManagedTarget


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--target")
    selection.add_argument(
        "--file", help="open an explicit file path (sensitive files refused)"
    )
    parser.add_argument("--project")
    parser.add_argument("--run-id")
    editor = parser.add_mutually_exclusive_group()
    editor.add_argument("--editor", help="GUI editor executable or known alias")
    editor.add_argument("--editor-app", help="macOS GUI application name for `open -a`")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--list-targets", action="store_true")
    return parser


def request_from(args: argparse.Namespace) -> ManagedFileRequest:
    if args.file:
        return ManagedFileRequest.for_file(args.root, args.file)
    if args.target:
        return ManagedFileRequest.for_target(
            args.root, args.target, project=args.project, run_id=args.run_id
        )
    raise ManagedFileError("either --target or --file is required")


def format_dry_run(path: Path, command: Sequence[str]) -> str:
    return f"file: {path}\ncommand: {shlex.join(command)}"


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.list_targets:
        print(" ".join(ManagedTarget.canonical_names()))
        return 0
    launcher = EditorLauncher.create()
    try:
        path = ManagedFileResolver.create().resolve(request_from(args))
        command = launcher.launch_command(path, args.editor, args.editor_app)
    except ManagedFileError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    if args.dry_run:
        print(format_dry_run(path, command))
        return 0
    return launcher.launch(command)


if __name__ == "__main__":
    raise SystemExit(main())
