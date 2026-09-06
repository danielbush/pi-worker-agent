#!/usr/bin/env python3
"""Resolve a managed task.md and open it in the selected GUI editor."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import NoReturn

ACTIVE = {"queued", "running", "blocked"}
TERMINAL_EDITORS = {
    "vi", "vim", "nvim", "nano", "emacs", "emacsclient", "helix", "hx",
    "kak", "micro",
}
KNOWN_GUI_EDITORS = ("code", "cursor", "zed", "subl", "mate", "idea", "pycharm", "fleet")
ALIASES = {
    "vscode": "code",
    "visual-studio-code": "code",
    "sublime": "subl",
    "sublime-text": "subl",
    "textmate": "mate",
    "intellij": "idea",
}


def fail(message: str) -> NoReturn:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(2)


def parse_time(value: object) -> tuple[int, str]:
    if not isinstance(value, str):
        return (0, "")
    try:
        return (1, datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat())
    except ValueError:
        return (0, value)


def load_state(project_dir: Path) -> dict:
    path = project_dir / "state.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"no state.json for project {project_dir.name!r}")
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read {path}: {exc}")
    if not isinstance(data, dict) or not isinstance(data.get("runs"), list):
        fail(f"invalid state structure in {path}")
    return data


def select_project(root: Path, name: str | None) -> Path:
    projects = root / "projects"
    if name:
        if Path(name).name != name or name in {".", ".."}:
            fail(f"unsafe project name: {name!r}")
        candidate = projects / name
        if not candidate.is_dir():
            fail(f"managed project {name!r} does not exist")
        return candidate
    candidates = sorted(p.parent for p in projects.glob("*/state.json"))
    if len(candidates) == 1:
        return candidates[0]
    names = ", ".join(p.name for p in candidates) or "none"
    fail(f"project is ambiguous; managed projects with state: {names}")


def select_run(state: dict, run_id: str | None) -> dict:
    runs = [r for r in state["runs"] if isinstance(r, dict)]
    if run_id:
        for run in runs:
            if run.get("run_id") == run_id:
                return run
        fail(f"run {run_id!r} is not present in current state")
    active = [r for r in runs if r.get("status") in ACTIVE]
    pool = active or runs
    if not pool:
        fail("project has no runs")
    return max(pool, key=lambda r: (parse_time(r.get("created")), str(r.get("run_id", ""))))


def task_path(project_dir: Path, run: dict) -> Path:
    raw = run.get("task_file")
    if not isinstance(raw, str) or not raw:
        fail(f"run {run.get('run_id')!r} has no task_file")
    project_root = project_dir.resolve()
    target = (project_dir / raw).resolve()
    try:
        target.relative_to(project_root)
    except ValueError:
        fail(f"task_file escapes project control directory: {raw!r}")
    if not target.is_file():
        fail(f"task file does not exist: {target}")
    return target


def available_gui_editors() -> list[str]:
    return [name for name in KNOWN_GUI_EDITORS if shutil.which(name)]


def editor_command(editor: str | None, editor_app: str | None) -> list[str]:
    if editor_app:
        if sys.platform != "darwin" or not shutil.which("open"):
            fail("--editor-app requires the macOS `open` command")
        return ["open", "-a", editor_app]
    if editor:
        normalized = editor.strip().lower().replace(" ", "-")
        command = ALIASES.get(normalized, editor.strip())
        base = Path(command).name.lower()
        if base in TERMINAL_EDITORS:
            fail(f"terminal editor {base!r} is intentionally unsupported")
        executable = shutil.which(command)
        if not executable:
            fail(f"GUI editor command is not available: {command!r}")
        return [executable]

    term_program = os.environ.get("TERM_PROGRAM", "").lower()
    signaled = []
    if "cursor" in term_program and shutil.which("cursor"):
        signaled.append("cursor")
    elif term_program == "vscode" and shutil.which("code"):
        signaled.append("code")
    elif "zed" in term_program and shutil.which("zed"):
        signaled.append("zed")
    if len(signaled) == 1:
        return [shutil.which(signaled[0]) or signaled[0]]

    available = available_gui_editors()
    if len(available) == 1:
        return [shutil.which(available[0]) or available[0]]
    choices = ", ".join(available) or "none detected"
    fail(f"GUI editor is ambiguous; pass --editor or --editor-app (available: {choices})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--project")
    parser.add_argument("--run-id")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--editor", help="GUI editor executable or known alias")
    group.add_argument("--editor-app", help="macOS GUI application name for `open -a`")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    project = select_project(root, args.project)
    target = task_path(project, select_run(load_state(project), args.run_id))
    command = [*editor_command(args.editor, args.editor_app), str(target)]
    if args.dry_run:
        print(f"task: {target}")
        print(f"command: {shlex.join(command)}")
        return 0
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
