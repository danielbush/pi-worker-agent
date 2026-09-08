"""APPLICATION: rebuild one project's `state.json` from its on-disk tasks tree.

The rebuild scans `projects/<project>/tasks/` and reconstructs the recorded
run inventory from what is actually on disk. Task directories map to runs.
Every numbered `NN-<token>.md` file -- reports, user-authored reviews, and
additional spec files alike -- maps to a job, directly at the task root or
one level deep inside `NN-<description>` track directories; only the run's
`00-task.md` task file maps to `task_file`, never a job. Recorded control
paths are rewritten only when they no longer resolve; lifecycle data
the rebuild cannot infer from disk -- run status, outcome, timestamps,
request, workspace, job statuses, execution fields, notes, and unknown
extensions -- is preserved verbatim on every matched record.

Scanning is strictly read-only. `rebuild(document)` returns a candidate
document (a deep copy with reconstructed runs) plus a per-run change summary;
the caller commits the candidate through `StateStore.update` only when the
user asked for `--write`. The rebuild never deletes a run or a job, never
archives to `history.jsonl`, and never invents a `run_id`.
"""

from __future__ import annotations

import copy
import json
import re
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path, PurePosixPath
from typing import Any

from tools.lib.core.domain.project_state_validation import (
    RUN_STATUSES,
    validate_project_state,
)
from tools.lib.core.infrastructure.filesystem import Filesystem

_TASK_DIR_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}--.+$")
_TRACK_DIR_NAME = re.compile(r"^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")
_NUMBERED_FILE = re.compile(r"^(\d{2})-(.+)\.md$")

_RUN_LEVEL_KEYS = frozenset({"run_id", "created", "status", "workflow", "workspace"})
_AUTHOR_ROLE_KEYS = frozenset({"author", "role"})
_PLANNED_JOB_STATUSES = frozenset({"pending", "queued"})


class FileKind(str, Enum):
    """Whether a numbered markdown file is a task spec or a job output."""

    SPEC = "spec"
    REPORT = "report"


@dataclass(frozen=True)
class ScanFile:
    """One recognized numbered `NN-<token>.md` file under a task directory."""

    path: str  # project-relative posix path, e.g. tasks/<dir>/<track>/05-x.md
    track: str | None  # track directory name, or None for the task root
    number: int
    token: str
    frontmatter: dict[str, str]
    text: str
    kind: FileKind


@dataclass(frozen=True)
class TaskDirScan:
    """One on-disk task directory plus recognized files and ignored items."""

    name: str
    rel: str  # project-relative directory, tasks/<name>
    files: list[ScanFile] = field(default_factory=list)  # canonical order
    ignored: list[tuple[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class DirDecision:
    """What one task directory maps to: an existing run, a new run, or nothing."""

    kind: str  # "existing" | "new"
    run_id: str | None = None


@dataclass(frozen=True)
class JobReconstruction:
    """A rebuilt job list and the finding lines the rebuild produced."""

    jobs: list[dict[str, Any]]
    change_findings: list[str]  # printed when the run's state would change
    stale_findings: list[str]  # printed whenever stale jobs are preserved


@dataclass(frozen=True)
class RebuildOutcome:
    """Candidate document and the human-readable per-run change summary."""

    candidate: dict[str, Any]
    lines: list[str]
    run_count: int
    changed_count: int


def parse_frontmatter(text: str) -> dict[str, str] | None:
    """Parse a leading `---` block of flat scalar lines; None when absent."""
    if not text.startswith("---"):
        return None
    lines = text.splitlines()
    if len(lines) < 3:
        return None
    end = -1
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            end = index
            break
    if end < 0:
        return None
    frontmatter: dict[str, str] = {}
    for line in lines[1:end]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ": " not in stripped:
            continue
        key, _, value = stripped.partition(": ")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        frontmatter[key] = value
    return frontmatter or None


def classify_file(stem: str, frontmatter: Mapping[str, str] | None) -> FileKind:
    """Classify a numbered file as spec-like or report-like (acceptance 3).

    Spec-like when frontmatter carries run-level keys without author/role, or
    -- when frontmatter is absent or ambiguous -- the file stem ends in
    `-task` (covering `00-task.md` and real files such as
    `04-characterization-task.md`). Everything else is report-like.
    """
    keys = set(frontmatter or {})
    has_run_level = bool(_RUN_LEVEL_KEYS & keys)
    has_author_role = bool(_AUTHOR_ROLE_KEYS & keys)
    if frontmatter and has_run_level and not has_author_role:
        return FileKind.SPEC
    if frontmatter and not has_run_level and has_author_role:
        return FileKind.REPORT
    if stem.endswith("-task"):
        return FileKind.SPEC
    return FileKind.REPORT


def _file_position(file: ScanFile) -> tuple[int, str, int, str]:
    """Order files: task root first, then tracks by name, then file number."""
    return (
        0 if file.track is None else 1,
        file.track or "",
        file.number,
        PurePosixPath(file.path).name,
    )


def _heading_title(text: str) -> str | None:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            return stripped[2:].strip() or None
    return None


def _original_request(text: str) -> str | None:
    """Return the `## Original request` section body, if present."""
    lines = text.splitlines()
    start = -1
    for index, line in enumerate(lines):
        if line.strip() == "## Original request":
            start = index + 1
            break
    if start < 0:
        return None
    body: list[str] = []
    for line in lines[start:]:
        if line.startswith("#"):
            break
        body.append(line)
    while body and not body[0].strip():
        body.pop(0)
    while body and not body[-1].strip():
        body.pop()
    return "\n".join(body) if body else None


def _relative_to_dir(scan: TaskDirScan, path: str) -> str:
    prefix = f"{scan.rel}/"
    return path.removeprefix(prefix)


def _virtual_position(report_file: str) -> tuple[int, str, int, str] | None:
    """Position key for a missing report path: track/root + number + name."""
    parts = PurePosixPath(report_file).parts
    if len(parts) == 3 and parts[0] == "tasks":
        track: str | None = None
    elif len(parts) == 4 and parts[0] == "tasks":
        track = parts[2]
    else:
        return None
    match = _NUMBERED_FILE.match(parts[-1])
    if match is None:
        return None
    return (
        0 if track is None else 1,
        track or "",
        int(match.group(1)),
        parts[-1],
    )


def _frontmatter_run_id(task_dir: TaskDirScan) -> str | None:
    spec = _canonical_spec(task_dir)
    if spec is None:
        return None
    run_id = spec.frontmatter.get("run_id", "").strip()
    return run_id or None


def _canonical_spec(task_dir: TaskDirScan) -> ScanFile | None:
    specs = sorted(
        (file for file in task_dir.files if file.kind is FileKind.SPEC),
        key=_file_position,
    )
    return specs[0] if specs else None


def _run_paths_under(run: Mapping[str, Any], dir_name: str) -> bool:
    prefix = f"tasks/{dir_name}/"
    values: list[Any] = [run.get("task_file")]
    jobs = run.get("jobs")
    if isinstance(jobs, list):
        values.extend(
            job.get("report_file")
            for job in jobs
            if isinstance(job, Mapping)
        )
    return any(
        isinstance(value, str) and value.startswith(prefix)
        for value in values
        if value
    )


def _scan_task_dir(
    project_dir: Path, tasks_dir: Path, name: str, filesystem: Filesystem
) -> TaskDirScan:
    """Recognize numbered markdown files at the task root and inside tracks."""
    task_dir = tasks_dir / name
    scan = TaskDirScan(name=name, rel=f"tasks/{name}")
    for child_name in filesystem.child_names(task_dir):
        child = task_dir / child_name
        if filesystem.is_dir(child):
            if _TRACK_DIR_NAME.match(child_name):
                _scan_track(project_dir, scan, task_dir, child_name, filesystem)
            else:
                scan.ignored.append(
                    (
                        "directory (not NN-<description>)",
                        f"{scan.rel}/{child_name}",
                    )
                )
            continue
        if not child_name.endswith(".md"):
            scan.ignored.append(
                ("non-markdown file", f"{scan.rel}/{child_name}")
            )
            continue
        match = _NUMBERED_FILE.match(child_name)
        if match is None:
            scan.ignored.append(
                ("markdown file (not NN-<token>.md)", f"{scan.rel}/{child_name}")
            )
            continue
        scan.files.append(
            _read_scan_file(project_dir, f"{scan.rel}/{child_name}", None, filesystem)
        )
    scan.files.sort(key=_file_position)
    return scan


def _scan_track(
    project_dir: Path,
    scan: TaskDirScan,
    task_dir: Path,
    track_name: str,
    filesystem: Filesystem,
) -> None:
    track_dir = task_dir / track_name
    for child_name in filesystem.child_names(track_dir):
        child = track_dir / child_name
        rel_path = f"{scan.rel}/{track_name}/{child_name}"
        if filesystem.is_dir(child):
            scan.ignored.append(("nested directory", rel_path))
            continue
        if not child_name.endswith(".md"):
            scan.ignored.append(("non-markdown file", rel_path))
            continue
        match = _NUMBERED_FILE.match(child_name)
        if match is None:
            scan.ignored.append(("markdown file (not NN-<token>.md)", rel_path))
            continue
        scan.files.append(_read_scan_file(project_dir, rel_path, track_name, filesystem))


def _read_scan_file(
    project_dir: Path, rel_path: str, track: str | None, filesystem: Filesystem
) -> ScanFile:
    text = filesystem.read_text(project_dir / PurePosixPath(rel_path))
    match = _NUMBERED_FILE.match(PurePosixPath(rel_path).name)
    assert match is not None
    number = int(match.group(1))
    token = match.group(2)
    frontmatter = parse_frontmatter(text)
    stem = PurePosixPath(rel_path).stem
    kind = classify_file(stem, frontmatter)
    return ScanFile(
        path=rel_path,
        track=track,
        number=number,
        token=token,
        frontmatter=frontmatter or {},
        text=text,
        kind=kind,
    )


class ProjectStateRebuilder:
    """INFRASTRUCTURE_CONSUMER: reconstruct one project state from its tasks tree.

    Scanning is read-only. `rebuild(document)` returns a candidate document
    (a deep copy with reconstructed runs) plus a per-run change summary; the
    caller decides whether to commit through `StateStore.update`.
    """

    def __init__(self, project_dir: Path, filesystem: Filesystem) -> None:
        self.project_dir = project_dir
        self.filesystem = filesystem

    @classmethod
    def create(cls, project_dir: Path) -> ProjectStateRebuilder:
        return cls(project_dir, Filesystem.create())

    @classmethod
    def create_null(
        cls,
        project_dir: Path,
        *,
        files: dict[str, str] | None = None,
        directories: Iterable[str] | None = None,
    ) -> ProjectStateRebuilder:
        return cls(
            project_dir,
            Filesystem.create_null(files=files, directories=directories),
        )

    def rebuild(self, document: Mapping[str, Any]) -> RebuildOutcome:
        """Reconstruct the run inventory from disk; never writes anything."""
        original = copy.deepcopy(dict(document))
        project = self._project_name(original)
        scans, global_lines = self._scan_project()
        recorded_runs = original.get("runs")
        if not isinstance(recorded_runs, list):
            recorded_runs = []
        archived_ids = self._archived_run_ids()
        decisions, untouched = self._decide_dirs(
            scans, recorded_runs, archived_ids
        )
        scan_by_name = {scan.name: scan for scan in scans}
        dir_for_run = {
            decision.run_id: scan_by_name[name]
            for name, decision in decisions.items()
            if decision.kind == "existing" and decision.run_id is not None
        }

        candidate_runs: list[dict[str, Any]] = []
        listing: dict[str, list[str]] = {}
        kept_lines: list[str] = []
        changed_count = 0

        for run in recorded_runs:
            run_id = run.get("run_id")
            scan = dir_for_run.get(run_id) if isinstance(run_id, str) else None
            if scan is None:
                kept_lines.append(
                    self._kept_run_line(run, decisions, scan_by_name)
                )
                candidate_runs.append(copy.deepcopy(dict(run)))
                continue
            rebuilt, block = self._rebuild_existing_run(run, scan)
            candidate_runs.append(rebuilt)
            if block is not None:
                listing[scan.name] = block
                if rebuilt != dict(run):
                    changed_count += 1
            else:
                listing[scan.name] = [f"{run_id} ({scan.rel}): unchanged"]

        for scan in scans:
            decision = decisions.get(scan.name)
            if decision is None or decision.kind != "new":
                continue
            new_run, block = self._new_run(scan)
            candidate_runs.append(new_run)
            listing[scan.name] = block
            changed_count += 1

        candidate = copy.deepcopy(dict(original))
        candidate["runs"] = candidate_runs
        validate_project_state(candidate, project, baseline=original)

        lines = [
            f"{project}: {len(candidate_runs)} runs, {changed_count} would change"
        ]
        for scan in scans:
            lines.extend(listing.get(scan.name, []))
        lines.extend(kept_lines)
        lines.extend(untouched)
        lines.extend(global_lines)
        if len(candidate_runs) > 20:
            lines.append(
                f"note: rebuilt state keeps {len(candidate_runs)} runs, above the "
                "default 20-run working bound. state.json may hold more; use "
                "uv run python -m tools.archive_state --project "
                f"{project} --write when you want to archive the oldest runs "
                "to history.jsonl."
            )
        return RebuildOutcome(
            candidate=candidate,
            lines=lines,
            run_count=len(candidate_runs),
            changed_count=changed_count,
        )

    def _project_name(self, document: Mapping[str, Any]) -> str:
        project = document.get("project")
        if isinstance(project, str) and project:
            return project
        return self.project_dir.name

    def _scan_project(self) -> tuple[list[TaskDirScan], list[str]]:
        tasks_dir = self.project_dir / "tasks"
        global_lines: list[str] = []
        if not self.filesystem.is_dir(tasks_dir):
            return [], global_lines
        scans: list[TaskDirScan] = []
        for name in self.filesystem.child_names(tasks_dir):
            if not self.filesystem.is_dir(tasks_dir / name):
                continue
            if not _TASK_DIR_NAME.match(name):
                global_lines.append(
                    f"tasks/{name}: ignored (not a YYYY-MM-DD--<slug> task directory)"
                )
                continue
            try:
                scans.append(
                    _scan_task_dir(self.project_dir, tasks_dir, name, self.filesystem)
                )
            except OSError as error:
                global_lines.append(
                    f"tasks/{name}: could not be scanned ({error}); left untouched"
                )
        return scans, global_lines


    def _archived_run_ids(self) -> set[str]:
        """Run ids already archived to history.jsonl (append-only archive)."""
        history = self.project_dir / "history.jsonl"
        if not self.filesystem.is_file(history):
            return set()
        ids: set[str] = set()
        for line in self.filesystem.read_text(history).splitlines():
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict) and isinstance(payload.get("run_id"), str):
                ids.add(payload["run_id"])
        return ids


    def _decide_dirs(
        self,
        scans: list[TaskDirScan],
        recorded_runs: list[dict[str, Any]],
        archived_ids: set[str] | None = None,
    ) -> tuple[dict[str, DirDecision], list[str]]:
        """Map each task directory to an existing run, a new run, or nothing."""
        run_by_id = {
            run["run_id"]: run
            for run in recorded_runs
            if isinstance(run.get("run_id"), str)
        }
        decisions: dict[str, DirDecision] = {}
        dir_by_run: dict[str, TaskDirScan] = {}
        untouched: list[str] = []
        for scan in scans:
            spec_run_id = _frontmatter_run_id(scan)
            candidates = [
                run for run in recorded_runs if _run_paths_under(run, scan.name)
            ]
            candidate_ids = {run["run_id"] for run in candidates}
            pick = (
                spec_run_id
                if spec_run_id in candidate_ids
                else (candidates[0]["run_id"] if candidates else None)
            )
            if pick is not None and pick not in dir_by_run:
                decisions[scan.name] = DirDecision(kind="existing", run_id=pick)
                dir_by_run[pick] = scan
                continue
            if pick is not None:
                owner = dir_by_run[pick]
                untouched.append(
                    f"{scan.rel}: left untouched (files already claimed by run "
                    f"{pick}, whose task directory is {owner.rel})"
                )
                continue
            if spec_run_id is not None and spec_run_id in run_by_id:
                target = run_by_id[spec_run_id]
                if spec_run_id in dir_by_run:
                    untouched.append(
                        f"{scan.rel}: left untouched (spec run_id {spec_run_id} "
                        f"already maps to {dir_by_run[spec_run_id].rel})"
                    )
                elif target.get("task_file") and self._file_exists(
                    str(target["task_file"])
                ):
                    untouched.append(
                        f"{scan.rel}: left untouched (spec run_id {spec_run_id} "
                        "already has a task file on disk)"
                    )
                else:
                    decisions[scan.name] = DirDecision(
                        kind="existing", run_id=spec_run_id
                    )
                    dir_by_run[spec_run_id] = scan
                continue
            if spec_run_id is not None and archived_ids and spec_run_id in archived_ids:
                untouched.append(
                    f"{scan.rel}: left untouched (spec run_id {spec_run_id} is "
                    "already archived in history.jsonl)"
                )
                continue
            if spec_run_id is not None:
                duplicate = next(
                    (
                        name
                        for name, decision in decisions.items()
                        if decision.kind == "new" and decision.run_id == spec_run_id
                    ),
                    None,
                )
                if duplicate is not None:
                    untouched.append(
                        f"{scan.rel}: left untouched (spec run_id {spec_run_id} "
                        f"already used by tasks/{duplicate})"
                    )
                else:
                    decisions[scan.name] = DirDecision(
                        kind="new", run_id=spec_run_id
                    )
                continue
            untouched.append(
                f"{scan.rel}: left untouched (no recorded run matches and no "
                "spec run_id)"
            )
        return decisions, untouched

    def _file_exists(self, project_relative: str) -> bool:
        path = PurePosixPath(project_relative)
        if path.is_absolute() or ".." in path.parts:
            return False
        return self.filesystem.is_file(self.project_dir / path)

    def _kept_run_line(
        self,
        run: dict[str, Any],
        decisions: Mapping[str, DirDecision],
        scan_by_name: Mapping[str, TaskDirScan],
    ) -> str:
        run_id = run.get("run_id") or "?"
        for name, decision in decisions.items():
            if decision.kind != "existing" or not _run_paths_under(run, name):
                continue
            if decision.run_id != run_id:
                scan = scan_by_name[name]
                return (
                    f"{run_id}: kept as recorded (task directory {scan.rel} "
                    f"belongs to run {decision.run_id})"
                )
        return f"{run_id}: kept as recorded (task directory not on disk)"

    def _rebuild_existing_run(
        self, run: dict[str, Any], scan: TaskDirScan
    ) -> tuple[dict[str, Any], list[str] | None]:
        """Rebuild one recorded run from its task directory's on-disk files."""
        rebuilt = copy.deepcopy(dict(run))
        task_file = self._task_file_for_run(run, scan)
        jobs = rebuilt.get("jobs")
        recorded_jobs = jobs if isinstance(jobs, list) else []
        reconstruction = self._rebuild_jobs(recorded_jobs, scan, task_file)
        rebuilt["jobs"] = reconstruction.jobs

        if task_file is not None:
            rebuilt["task_file"] = task_file
        elif "task_file" in rebuilt:
            del rebuilt["task_file"]

        changed = rebuilt != dict(run)
        if not changed and not reconstruction.stale_findings:
            return rebuilt, None
        run_id = run.get("run_id") or "?"
        block = [f"{run_id} ({scan.rel})"]
        if changed:
            block.extend(f"  {line}" for line in reconstruction.change_findings)
            block.extend(f"  {line}" for line in reconstruction.stale_findings)
            if task_file != run.get("task_file"):
                old = run.get("task_file") or "(none)"
                block.append(f"  ~ task file changed: {old} -> {task_file or '(none)'}")
            block.extend(self._ignored_findings(scan))
        else:
            block.append("  state unchanged; stale job(s) preserved as recorded")
            block.extend(f"  {line}" for line in reconstruction.stale_findings)
        return rebuilt, block

    def _new_run(self, scan: TaskDirScan) -> tuple[dict[str, Any], list[str]]:
        """Build a brand-new run from the directory's canonical spec file."""
        spec = _canonical_spec(scan)
        assert spec is not None
        frontmatter = spec.frontmatter
        run_id = frontmatter.get("run_id", "").strip()
        status = frontmatter.get("status", "").strip()
        status_from_spec = status in RUN_STATUSES
        if not status_from_spec:
            status = "awaiting-approval"
        run: dict[str, Any] = {"run_id": run_id, "status": status}
        if frontmatter.get("workflow"):
            run["workflow"] = frontmatter["workflow"]
        if frontmatter.get("created"):
            run["created"] = frontmatter["created"]
        run["task_file"] = spec.path
        if frontmatter.get("workspace"):
            run["workspace"] = frontmatter["workspace"]
        title = _heading_title(spec.text)
        if title is not None:
            run["title"] = title
        request = _original_request(spec.text)
        if request is not None:
            run["request"] = request
        reconstruction = self._rebuild_jobs([], scan, spec.path)
        run["jobs"] = reconstruction.jobs

        block = [f"{run_id} ({scan.rel})"]
        block.append("  + new run reconstructed from on-disk spec")
        source = (
            "spec frontmatter"
            if status_from_spec
            else "default awaiting-approval (spec status absent or invalid)"
        )
        block.append(f"  + status {status} ({source})")
        if "created" in run:
            block.append(f"  + created {run['created']} (spec frontmatter, as-is)")
        if "workflow" in run:
            block.append(f"  + workflow {run['workflow']} (spec frontmatter)")
        if "workspace" in run:
            block.append(f"  + workspace {run['workspace']} (spec frontmatter)")
        if "title" in run:
            block.append(f"  + title {run['title']}")
        if "request" in run:
            block.append("  + request from spec ## Original request section")
        block.extend(f"  {line}" for line in reconstruction.change_findings)
        block.extend(f"  {line}" for line in reconstruction.stale_findings)
        block.extend(self._ignored_findings(scan))
        return run, block

    def _ignored_findings(self, scan: TaskDirScan) -> list[str]:
        """Unrecognized on-disk items under the task directory.

        Every recognized numbered file is now a job or the run's task file,
        so the only per-file findings left are items the scanner ignored.
        """
        return [
            f"  ~ ignored {kind}: {_relative_to_dir(scan, path)}"
            for kind, path in scan.ignored
        ]

    def _task_file_for_run(
        self, run: dict[str, Any], scan: TaskDirScan
    ) -> str | None:
        """Keep the recorded task file when it still exists as a spec on disk."""
        recorded = run.get("task_file")
        if isinstance(recorded, str):
            known = next(
                (file for file in scan.files if file.path == recorded), None
            )
            if known is not None and known.kind is FileKind.SPEC:
                return recorded
        specs = sorted(
            (file for file in scan.files if file.kind is FileKind.SPEC),
            key=_file_position,
        )
        return specs[0].path if specs else None

    def _rebuild_jobs(
        self,
        recorded_jobs: list[dict[str, Any]],
        scan: TaskDirScan,
        task_file: str | None,
    ) -> JobReconstruction:
        """Match on-disk job files to recorded jobs and synthesize the rest.

        The run's task file is not a job. Every other numbered file maps to a
        job: the rebuilt list walks the files in canonical order, a file
        matched to a recorded job keeps that job verbatim at the file's
        position, and an unmatched file -- report, user-authored review, or
        additional spec -- gets a synthesized `done` job named from its file
        token. Recorded jobs whose report file is missing are preserved
        verbatim at the file number their report would occupy; recorded jobs
        without a report path keep their recorded slots. Nothing is ever
        deleted.
        """
        claimed: set[int] = set()
        matched_job: dict[str, int] = {}
        for file in scan.files:
            if file.path == task_file:
                continue
            for index, job in enumerate(recorded_jobs):
                if index in claimed:
                    continue
                report_file = job.get("report_file")
                if isinstance(report_file, str) and report_file == file.path:
                    matched_job[file.path] = index
                    claimed.add(index)
                    break

        counts: Counter[str] = Counter(
            job.get("job") or "" for job in recorded_jobs
        )

        def name_for(token: str) -> str:
            taken = counts.get(token, 0)
            counts[token] = taken + 1
            return token if taken == 0 else f"{token}-{taken + 1}"

        change_findings: list[str] = []
        stale_findings: list[str] = []
        sequenced: list[tuple[tuple[int, str, int, str], dict[str, Any], int | None]] = []
        for file in scan.files:
            if file.path == task_file:
                continue
            if file.path in matched_job:
                index = matched_job[file.path]
                sequenced.append((_file_position(file), recorded_jobs[index], index))
                continue
            name = name_for(file.token)
            job: dict[str, Any] = {
                "job": name,
                "status": "done",
                "report_file": file.path,
            }
            sequenced.append((_file_position(file), job, None))
            change_findings.append(
                f"+ record job {name} (done) -> {_relative_to_dir(scan, file.path)}"
            )

        missing: list[tuple[tuple[int, str, int, str], dict[str, Any], int]] = []
        unpositioned: list[tuple[dict[str, Any], int]] = []
        for index, job in enumerate(recorded_jobs):
            if index in claimed:
                continue
            report_file = job.get("report_file")
            name = job.get("job") or "?"
            if not isinstance(report_file, str) or not report_file:
                unpositioned.append((job, index))
                continue
            if self._file_exists(report_file):
                unpositioned.append((job, index))
                continue
            virtual = _virtual_position(report_file)
            filename = PurePosixPath(report_file).name
            if job.get("status") in _PLANNED_JOB_STATUSES:
                change_findings.append(
                    f"~ preserve planned job {name} ({filename} not on disk yet)"
                )
            else:
                stale_findings.append(
                    f"~ stale job {name} preserved as recorded "
                    f"({filename} missing on disk)"
                )
            if virtual is None:
                unpositioned.append((job, index))
            else:
                missing.append((virtual, job, index))
        missing.sort(key=lambda item: item[0])

        merged: list[tuple[tuple[int, str, int, str], dict[str, Any], int | None]] = []
        missing_index = 0
        for item in sequenced:
            while (
                missing_index < len(missing)
                and missing[missing_index][0] < item[0]
            ):
                merged.append(missing[missing_index])
                missing_index += 1
            merged.append(item)
        while missing_index < len(missing):
            merged.append(missing[missing_index])
            missing_index += 1

        # Recorded jobs without a usable report path keep their recorded
        # slots: after the positioned recorded jobs that precede them.
        slots_by_gap: dict[int, list[tuple[dict[str, Any], int]]] = {}
        for job, recorded_index in sorted(unpositioned, key=lambda item: item[1]):
            gap = sum(
                1
                for _, _, index in merged
                if index is not None and index < recorded_index
            )
            slots_by_gap.setdefault(gap, []).append((job, recorded_index))

        final: list[tuple[tuple[int, str, int, str], dict[str, Any], int | None]] = []
        emitted_recorded = 0
        for item in merged:
            while slots_by_gap and emitted_recorded in slots_by_gap:
                for slot_job, slot_index in slots_by_gap.pop(emitted_recorded):
                    final.append(((2, "", 0, ""), slot_job, slot_index))
            final.append(item)
            if item[2] is not None:
                emitted_recorded += 1
        for gap in sorted(slots_by_gap):
            for slot_job, slot_index in slots_by_gap[gap]:
                final.append(((2, "", 0, ""), slot_job, slot_index))

        jobs = [job for _, job, _ in final]
        return JobReconstruction(
            jobs=jobs,
            change_findings=change_findings,
            stale_findings=stale_findings,
        )
