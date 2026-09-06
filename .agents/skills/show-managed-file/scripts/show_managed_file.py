#!/usr/bin/env python3
"""Resolve an authoritative Prime Worker Agent file and open it in a GUI editor."""

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
    "vscode": "code", "visual-studio-code": "code", "sublime": "subl",
    "sublime-text": "subl", "textmate": "mate", "intellij": "idea",
}
TARGET_ALIASES = {
    "task": "task", "original-task": "task", "brief": "task",
    "original-brief": "task", "models": "models", "model": "models",
    "model-config": "models", "models.json": "models",
    "workflow": "workflows", "workflows": "workflows",
    "architecture": "architecture", "arch": "architecture",
    "policy": "policy", "agents": "policy", "manager-policy": "policy",
    "project": "project", "project-context": "project",
    "project-readme": "project", "state": "state", "state.json": "state",
    "tasks": "project-tasks", "project-tasks": "project-tasks",
    "project-index": "project-tasks", "root-tasks": "root-tasks",
    "root-index": "root-tasks",
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


def require_file(path: Path, description: str) -> Path:
    target = path.expanduser().resolve()
    if not target.is_file():
        fail(f"{description} does not exist: {target}")
    return target


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


def managed_task(project_dir: Path, run_id: str | None) -> Path:
    run = select_run(load_state(project_dir), run_id)
    raw = run.get("task_file")
    if not isinstance(raw, str) or not raw:
        fail(f"run {run.get('run_id')!r} has no task_file")
    project_root = project_dir.resolve()
    target = (project_dir / raw).resolve()
    try:
        target.relative_to(project_root)
    except ValueError:
        fail(f"task_file escapes project control directory: {raw!r}")
    return require_file(target, "task file")


def resolve_target(root: Path, target: str, project_name: str | None, run_id: str | None) -> Path:
    kind = TARGET_ALIASES.get(target.strip().lower())
    if not kind:
        fail(f"unknown target {target!r}; use --list-targets")
    if run_id and kind != "task":
        fail("--run-id is valid only for the task target")
    if kind == "models":
        return require_file(Path.home() / ".prime/agent/models.json", "model configuration")
    if kind == "workflows":
        return require_file(root / "WORKFLOWS.md", "workflow configuration")
    if kind == "architecture":
        return require_file(root / "docs/ARCHITECTURE.md", "architecture document")
    if kind == "policy":
        return require_file(root / "AGENTS.md", "manager policy")
    if kind == "root-tasks":
        return require_file(root / "TASKS.md", "root task index")
    project = select_project(root, project_name)
    if kind == "task":
        return managed_task(project, run_id)
    names = {"project": "README.md", "state": "state.json", "project-tasks": "TASKS.md"}
    return require_file(project / names[kind], f"{kind} file")


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
        if Path(command).name.lower() in TERMINAL_EDITORS:
            fail(f"terminal editor {Path(command).name.lower()!r} is intentionally unsupported")
        executable = shutil.which(command)
        if not executable:
            fail(f"GUI editor command is not available: {command!r}")
        return [executable]
    term_program = os.environ.get("TERM_PROGRAM", "").lower()
    if "cursor" in term_program and shutil.which("cursor"):
        return [shutil.which("cursor") or "cursor"]
    if term_program == "vscode" and shutil.which("code"):
        return [shutil.which("code") or "code"]
    if "zed" in term_program and shutil.which("zed"):
        return [shutil.which("zed") or "zed"]
    available = available_gui_editors()
    if len(available) == 1:
        return [shutil.which(available[0]) or available[0]]
    choices = ", ".join(available) or "none detected"
    fail(f"GUI editor is ambiguous; pass --editor or --editor-app (available: {choices})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--target")
    parser.add_argument("--project")
    parser.add_argument("--run-id")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--editor", help="GUI editor executable or known alias")
    group.add_argument("--editor-app", help="macOS GUI application name for `open -a`")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--list-targets", action="store_true")
    args = parser.parse_args()
    if args.list_targets:
        print("task models workflows architecture policy project state project-tasks root-tasks")
        return 0
    if not args.target:
        fail("--target is required")
    root = args.root.expanduser().resolve()
    target = resolve_target(root, args.target, args.project, args.run_id)
    command = [*editor_command(args.editor, args.editor_app), str(target)]
    if args.dry_run:
        print(f"file: {target}")
        print(f"command: {shlex.join(command)}")
        return 0
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
