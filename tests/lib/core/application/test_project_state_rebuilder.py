"""Tests for rebuilding project state from the on-disk tasks tree."""

from __future__ import annotations

import json
from pathlib import Path

from tools.lib.core.application.project_state_rebuilder import (
    FileKind,
    ProjectStateRebuilder,
    classify_file,
    parse_frontmatter,
)
from tools.lib.core.application.state_store import StateStore
from tools.lib.core.infrastructure.filesystem import Filesystem

ROOT = Path("/repo")


def spec_file(
    run_id: str,
    *,
    status: str = "done",
    workflow: str = "investigate",
    title: str = "Investigate things",
) -> str:
    return (
        "---\n"
        f"run_id: {run_id}\n"
        "created: 2026-09-08\n"
        f"status: {status}\n"
        f"workflow: {workflow}\n"
        "workspace: /work\n"
        "---\n"
        f"\n# {title}\n\n"
        "## Original request\n\n"
        "Investigate the thing, please.\n"
    )


def report_file(token: str, *, role: str = "investigator") -> str:
    return (
        "---\n"
        f"author: codex (rlm, openai-codex/gpt-5.6-sol, medium)\n"
        f"role: {role}\n"
        "date: 2026-09-08\n"
        "---\n"
        f"\n# Report for {token}\n"
    )


USER_REVIEW = (
    "---\nauthor: user\nrole: reviewer\ndate: 2026-09-08\n---\n\n# Review\n"
)


def state_json(project: str, runs: list[dict]) -> str:
    return json.dumps({"project": project, "path": "/work", "runs": runs, "archived": 0})


def make_fs(
    project: str,
    state: dict,
    task_files: dict[str, str],
    extra_dirs: list[str] | None = None,
) -> Filesystem:
    files = {
        str(ROOT / "projects" / project / "state.json"): json.dumps(state),
    }
    for rel, text in task_files.items():
        files[str(ROOT / "projects" / project / rel)] = text
    directories = [str(ROOT / "projects" / project)]
    directories.extend(str(ROOT / "projects" / project / rel) for rel in (extra_dirs or []))
    return Filesystem.create_null(files=files, directories=directories)


def run(rid: str, **overrides: object) -> dict:
    base: dict[str, object] = {
        "run_id": rid,
        "title": "A run",
        "workflow": "manual",
        "status": "done",
        "created": "2026-09-08T10:00:00",
        "task_file": f"tasks/{rid}/00-task.md",
        "workspace": "/work",
        "jobs": [],
    }
    base.update(overrides)
    return base


# --------------------------------------------------------------------------
# File classification
# --------------------------------------------------------------------------


def test_parse_frontmatter_basic_and_absent() -> None:
    # arrange / act / assert
    assert parse_frontmatter("no frontmatter here\n# Title\n") is None
    parsed = parse_frontmatter(
        "---\nrun_id: 2026-09-08-1000-build\n"
        "author: codex (a, b, medium)\nnote: a: b\n---\n# Body\n"
    )
    assert parsed is not None
    assert parsed["run_id"] == "2026-09-08-1000-build"
    assert parsed["author"] == "codex (a, b, medium)"
    assert parsed["note"] == "a: b"


def test_classify_spec_like_and_report_like() -> None:
    # arrange / act / assert
    spec_fm = {"run_id": "R", "created": "2026-09-08", "status": "done"}
    assert classify_file("00-task", spec_fm) is FileKind.SPEC
    assert classify_file("04-characterization-task", spec_fm) is FileKind.SPEC
    report_fm = {"author": "codex (rlm, m, medium)", "role": "investigator"}
    assert classify_file("01-investigate", report_fm) is FileKind.REPORT
    # no frontmatter: the -task stem rule covers 00-task.md and *-task.md
    assert classify_file("00-task", None) is FileKind.SPEC
    assert classify_file("06-implement-task", None) is FileKind.SPEC
    assert classify_file("05-characterization-plan", None) is FileKind.REPORT
    # ambiguous frontmatter falls back to the stem rule
    mixed = {"run_id": "R", "author": "user", "role": "reviewer"}
    assert classify_file("00-task", mixed) is FileKind.SPEC
    assert classify_file("01-x", mixed) is FileKind.REPORT


# --------------------------------------------------------------------------
# Scanner behaviour
# --------------------------------------------------------------------------


def test_scan_recognizes_root_and_track_files_and_ignores_others() -> None:
    # arrange
    state = state_json(
        "demo",
        [
            run(
                "2026-09-08-1000-x",
                task_file="tasks/2026-09-08--some-dir/00-task.md",
            )
        ],
    )
    dir_name = "2026-09-08--some-dir"
    files = {
        f"tasks/{dir_name}/00-task.md": spec_file("2026-09-08-1000-x"),
        f"tasks/{dir_name}/01-a.md": report_file("a"),
        f"tasks/{dir_name}/00-track/00-task.md": spec_file(
            "2026-09-08-1000-x", title="Track spec"
        ),
        f"tasks/{dir_name}/00-track/05-b.md": report_file("b"),
        f"tasks/{dir_name}/notes.md": "# not numbered\n",
        f"tasks/{dir_name}/logs/x.jsonl": "{}",
        f"tasks/{dir_name}/00-track/deep/c.md": report_file("c"),
        f"tasks/{dir_name}/README.txt": "not markdown",
    }
    fs = make_fs(
        "demo",
        json.loads(state),
        files,
        extra_dirs=[f"tasks/{dir_name}/logs", f"tasks/{dir_name}/00-track/deep"],
    )
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert: scanner inventory is not directly exposed, so exercise via the
    # rebuilt candidate (task file is the root spec; the track's own
    # 00-task.md spec is an additional numbered file, so it becomes a job)
    rebuilt = next(
        r for r in outcome.candidate["runs"] if r["run_id"] == "2026-09-08-1000-x"
    )
    assert rebuilt["task_file"] == f"tasks/{dir_name}/00-task.md"
    assert [job["job"] for job in rebuilt["jobs"]] == ["a", "task", "b"]
    assert rebuilt["jobs"][1]["report_file"] == f"tasks/{dir_name}/00-track/00-task.md"
    assert any(
        "ignored directory (not NN-<description>): logs" in line
        for line in outcome.lines
    )
    assert any(
        "ignored markdown file (not NN-<token>.md): notes.md" in line
        for line in outcome.lines
    )
    assert any(
        "ignored non-markdown file: README.txt" in line for line in outcome.lines
    )
    assert any(
        "ignored nested directory: 00-track/deep" in line for line in outcome.lines
    )


def test_scan_reports_nonconforming_task_directory() -> None:
    # arrange
    state = state_json("demo", [])
    fs = make_fs(
        "demo",
        json.loads(state),
        {},
        extra_dirs=["tasks/not-a-task-dir"],
    )
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert
    assert any("not-a-task-dir" in line and "ignored" in line for line in outcome.lines)


# --------------------------------------------------------------------------
# Run/job reconstruction with nested tracks (the chat drift shape)
# --------------------------------------------------------------------------


def _chat_like_fixture() -> tuple[dict, dict[str, str]]:
    dir_name = "2026-09-08--investigate-structures"
    prefix = f"tasks/{dir_name}"
    state = state_json(
        "demo",
        [
            run(
                "2026-09-08-0035-investigate",
                title="Investigate structures DSL",
                workflow="investigate",
                status="awaiting-approval",
                created="2026-09-08T00:35:00",
                approved="2026-09-08T00:39:00",
                started="2026-09-08T00:39:00",
                task_file=f"{prefix}/00-investigate-structures/00-task.md",
                jobs=[
                    {
                        "job": "investigate",
                        "harness": "rlm",
                        "model": "m",
                        "thinking": "medium",
                        "route": None,
                        "status": "done",
                        "report_file": f"{prefix}/00-investigate-structures/01-investigate.md",
                        "started": "2026-09-08T00:39:00",
                        "finished": "2026-09-08T00:55:55",
                    },
                    {
                        "job": "investigate-revision",
                        "status": "done",
                        "report_file": f"{prefix}/00-investigate-structures/03-investigate-revision.md",
                    },
                    {
                        "job": "implement-characterization-tests",
                        "status": "queued",
                        "report_file": f"{prefix}/01-characterization-tests/07-implement.md",
                    },
                    {
                        "job": "review-characterization-tests",
                        "status": "queued",
                        "report_file": f"{prefix}/01-characterization-tests/08-review.md",
                    },
                ],
            ),
            run(
                "2026-09-08-0900-build",
                task_file="tasks/2026-09-08--live-chat/00-task.md",
                jobs=[
                    {
                        "job": "plan",
                        "status": "cancelled",
                        "note": "skipped per user",
                    },
                    {
                        "job": "implement",
                        "status": "done",
                        "report_file": "tasks/2026-09-08--live-chat/01-implement.md",
                    },
                ],
            ),
        ],
    )
    files = {
        f"{prefix}/00-investigate-structures/00-task.md": spec_file(
            "2026-09-08-0035-investigate",
            status="done",
            title="Investigate the structures DSL",
        ),
        f"{prefix}/00-investigate-structures/01-investigate.md": report_file(
            "investigate"
        ),
        f"{prefix}/00-investigate-structures/02-review.md": USER_REVIEW,
        f"{prefix}/00-investigate-structures/03-investigate-revision.md": report_file(
            "investigate-revision"
        ),
        f"{prefix}/01-characterization-tests/04-characterization-task.md": spec_file(
            "2026-09-08-0035-investigate", title="Characterization task"
        ),
        f"{prefix}/01-characterization-tests/05-characterization-plan.md": report_file(
            "characterization-plan"
        ),
        f"{prefix}/01-characterization-tests/06-implement-task.md": spec_file(
            "2026-09-08-0035-investigate", title="Implement task"
        ),
        "tasks/2026-09-08--live-chat/00-task.md": spec_file("2026-09-08-0900-build"),
        "tasks/2026-09-08--live-chat/01-implement.md": report_file(
            "implement", role="implementer"
        ),
    }
    return json.loads(state), files


def test_rebuild_matches_demo_drift_with_nested_track_paths() -> None:
    # arrange
    state, files = _chat_like_fixture()
    fs = make_fs("demo", state, files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(state)

    # assert
    assert outcome.run_count == 2
    assert outcome.changed_count == 1
    rebuilt = next(
        r for r in outcome.candidate["runs"] if r["run_id"] == "2026-09-08-0035-investigate"
    )
    dir_name = "2026-09-08--investigate-structures"
    assert (
        rebuilt["task_file"]
        == f"tasks/{dir_name}/00-investigate-structures/00-task.md"
    )
    # Every numbered file on disk is now a job: the user review (02), the
    # extra spec files (04, 06), and the characterization plan (05) join the
    # recorded jobs in file order; only 00-task.md stays the task file.
    assert [job["job"] for job in rebuilt["jobs"]] == [
        "investigate",
        "review",
        "investigate-revision",
        "characterization-task",
        "characterization-plan",
        "implement-task",
        "implement-characterization-tests",
        "review-characterization-tests",
    ]
    assert rebuilt["jobs"][1] == {
        "job": "review",
        "status": "done",
        "report_file": (
            f"tasks/{dir_name}/00-investigate-structures/02-review.md"
        ),
    }
    assert rebuilt["jobs"][3] == {
        "job": "characterization-task",
        "status": "done",
        "report_file": (
            f"tasks/{dir_name}/01-characterization-tests/04-characterization-task.md"
        ),
    }
    assert rebuilt["jobs"][4] == {
        "job": "characterization-plan",
        "status": "done",
        "report_file": (
            f"tasks/{dir_name}/01-characterization-tests/05-characterization-plan.md"
        ),
    }
    assert rebuilt["jobs"][5] == {
        "job": "implement-task",
        "status": "done",
        "report_file": (
            f"tasks/{dir_name}/01-characterization-tests/06-implement-task.md"
        ),
    }
    assert rebuilt["jobs"][6]["status"] == "queued"
    assert rebuilt["jobs"][7]["status"] == "queued"
    # the recorded queued jobs stay verbatim
    original = next(
        r for r in state["runs"] if r["run_id"] == "2026-09-08-0035-investigate"
    )
    assert rebuilt["jobs"][6] == original["jobs"][2]
    assert rebuilt["jobs"][7] == original["jobs"][3]
    # the healthy run is byte-identical in content
    healthy = next(
        r for r in outcome.candidate["runs"] if r["run_id"] == "2026-09-08-0900-build"
    )
    assert healthy == next(
        r for r in state["runs"] if r["run_id"] == "2026-09-08-0900-build"
    )
    text = "\n".join(outcome.lines)
    assert "+ record job review (done) -> 00-investigate-structures/02-review.md" in text
    assert "+ record job characterization-task (done) -> 01-characterization-tests/04-characterization-task.md" in text
    assert "+ record job characterization-plan (done) ->" in text
    assert "+ record job implement-task (done) -> 01-characterization-tests/06-implement-task.md" in text
    assert "~ preserve planned job implement-characterization-tests (07-implement.md not on disk yet)" in text
    assert "~ preserve planned job review-characterization-tests (08-review.md not on disk yet)" in text
    assert (
        "~ user-authored review not recorded as a job: "
        "00-investigate-structures/02-review.md" not in text
    )
    assert (
        "~ additional spec file not recorded: "
        "01-characterization-tests/04-characterization-task.md" not in text
    )
    assert (
        "~ additional spec file not recorded: "
        "01-characterization-tests/06-implement-task.md" not in text
    )
    assert "2026-09-08-0900-build" in text and ": unchanged" in text


def test_every_numbered_file_becomes_a_job_and_task_file_stays_spec() -> None:
    # arrange: a task directory holding a spec, a report, a user-authored
    # review, and an additional spec-like file; the run records no jobs yet
    dir_name = "2026-09-08--every-file"
    state = state_json(
        "demo",
        [
            run(
                "2026-09-08-1000-x",
                task_file=f"tasks/{dir_name}/00-task.md",
                jobs=[],
            )
        ],
    )
    files = {
        f"tasks/{dir_name}/00-task.md": spec_file("2026-09-08-1000-x"),
        f"tasks/{dir_name}/01-implement.md": report_file(
            "implement", role="implementer"
        ),
        f"tasks/{dir_name}/02-review.md": USER_REVIEW,
        f"tasks/{dir_name}/03-plan-task.md": spec_file(
            "2026-09-08-1000-x", title="Plan task"
        ),
    }
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert: 00-task.md stays the task file, and every other numbered file
    # is recorded as a `done` job named from its file token
    rebuilt = outcome.candidate["runs"][0]
    assert rebuilt["task_file"] == f"tasks/{dir_name}/00-task.md"
    assert [job["job"] for job in rebuilt["jobs"]] == [
        "implement",
        "review",
        "plan-task",
    ]
    assert rebuilt["jobs"] == [
        {
            "job": "implement",
            "status": "done",
            "report_file": f"tasks/{dir_name}/01-implement.md",
        },
        {
            "job": "review",
            "status": "done",
            "report_file": f"tasks/{dir_name}/02-review.md",
        },
        {
            "job": "plan-task",
            "status": "done",
            "report_file": f"tasks/{dir_name}/03-plan-task.md",
        },
    ]
    text = "\n".join(outcome.lines)
    assert "+ record job implement (done)" in text
    assert "+ record job review (done) -> 02-review.md" in text
    assert "+ record job plan-task (done) -> 03-plan-task.md" in text
    assert "user-authored review not recorded" not in text
    assert "additional spec file not recorded" not in text


def test_rebuild_is_idempotent() -> None:
    # arrange
    state, files = _chat_like_fixture()
    fs = make_fs("demo", state, files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)
    first = rebuilder.rebuild(state)

    # act
    second = rebuilder.rebuild(first.candidate)

    # assert
    assert second.candidate == first.candidate
    assert second.changed_count == 0
    assert all("would change" in line for line in second.lines if line.startswith("demo:"))


def test_synthesized_jobs_use_unique_names() -> None:
    # arrange: two report files with the same token across tracks
    state = state_json(
        "demo",
        [
            run(
                "2026-09-08-1000-x",
                task_file="tasks/2026-09-08--dir/00-task.md",
                jobs=[],
            )
        ],
    )
    files = {
        "tasks/2026-09-08--dir/00-task.md": spec_file("2026-09-08-1000-x"),
        "tasks/2026-09-08--dir/00-a/02-plan.md": report_file("plan"),
        "tasks/2026-09-08--dir/01-b/03-plan.md": report_file("plan"),
    }
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert
    rebuilt = outcome.candidate["runs"][0]
    assert [job["job"] for job in rebuilt["jobs"]] == ["plan", "plan-2"]


def test_planned_and_stale_jobs_reported_and_preserved() -> None:
    # arrange
    state = state_json(
        "demo",
        [
            run(
                "2026-09-08-1000-x",
                task_file="tasks/2026-09-08--dir/00-task.md",
                jobs=[
                    {
                        "job": "next",
                        "status": "queued",
                        "report_file": "tasks/2026-09-08--dir/05-next.md",
                    },
                    {
                        "job": "lost",
                        "status": "done",
                        "started": "2026-09-08T10:00:00",
                        "report_file": "tasks/2026-09-08--dir/07-lost.md",
                    },
                ],
            )
        ],
    )
    files = {"tasks/2026-09-08--dir/00-task.md": spec_file("2026-09-08-1000-x")}
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert: no file-backed change, so the run is unchanged, but the stale
    # job is still reported while the planned job line needs no state change
    rebuilt = outcome.candidate["runs"][0]
    assert [job["job"] for job in rebuilt["jobs"]] == ["next", "lost"]
    assert rebuilt["jobs"][0] == {
        "job": "next",
        "status": "queued",
        "report_file": "tasks/2026-09-08--dir/05-next.md",
    }
    text = "\n".join(outcome.lines)
    assert "~ stale job lost preserved as recorded (07-lost.md missing on disk)" in text
    assert "state unchanged; stale job(s) preserved as recorded" in text


def test_verbatim_preservation_of_lifecycle_fields() -> None:
    # arrange: spec frontmatter disagrees with recorded state; state wins
    state, files = _chat_like_fixture()
    fs = make_fs("demo", state, files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(state)

    # assert
    original = next(
        r for r in state["runs"] if r["run_id"] == "2026-09-08-0035-investigate"
    )
    rebuilt = next(
        r
        for r in outcome.candidate["runs"]
        if r["run_id"] == "2026-09-08-0035-investigate"
    )
    for field in (
        "status",
        "created",
        "approved",
        "started",
        "workspace",
        "title",
        "workflow",
    ):
        assert rebuilt[field] == original[field], field
    if "request" in original:
        assert rebuilt["request"] == original["request"]
    assert "outcome" not in rebuilt or rebuilt["outcome"] == original.get("outcome")
    matched = rebuilt["jobs"][0]
    assert matched["started"] == "2026-09-08T00:39:00"
    assert matched["harness"] == "rlm"


# --------------------------------------------------------------------------
# Existing runs kept, new runs created, dirs left untouched
# --------------------------------------------------------------------------


def test_run_without_task_directory_kept_as_recorded() -> None:
    # arrange: state has a run whose directory does not exist on disk
    state = state_json(
        "demo",
        [run("2026-09-08-1000-x", task_file="tasks/2026-09-08--gone/00-task.md")],
    )
    fs = make_fs("demo", json.loads(state), {})
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert
    assert outcome.changed_count == 0
    assert outcome.candidate["runs"][0]["run_id"] == "2026-09-08-1000-x"
    assert any(
        "kept as recorded (task directory not on disk)" in line
        for line in outcome.lines
    )


def test_new_run_reconstructed_from_spec() -> None:
    # arrange: a task directory whose spec run_id matches no recorded run
    state = state_json("demo", [])
    dir_name = "2026-09-08--brand-new"
    files = {
        f"tasks/{dir_name}/00-task.md": spec_file(
            "2026-09-08-1200-x",
            status="done",
            workflow="build",
            title="Brand new work",
        ),
        f"tasks/{dir_name}/01-implement.md": report_file(
            "implement", role="implementer"
        ),
    }
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert
    assert outcome.run_count == 1
    assert outcome.changed_count == 1
    new_run = outcome.candidate["runs"][0]
    assert new_run["run_id"] == "2026-09-08-1200-x"
    assert new_run["status"] == "done"
    assert new_run["workflow"] == "build"
    assert new_run["created"] == "2026-09-08"
    assert new_run["title"] == "Brand new work"
    assert new_run["request"] == "Investigate the thing, please."
    assert new_run["task_file"] == f"tasks/{dir_name}/00-task.md"
    assert new_run["jobs"] == [
        {
            "job": "implement",
            "status": "done",
            "report_file": f"tasks/{dir_name}/01-implement.md",
        }
    ]


def test_directory_without_spec_run_id_left_untouched() -> None:
    # arrange
    state = state_json("demo", [])
    dir_name = "2026-09-08--orphan"
    files = {
        f"tasks/{dir_name}/01-report.md": report_file("report"),
    }
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert
    assert outcome.candidate["runs"] == []
    assert any(
        "left untouched (no recorded run matches and no spec run_id)" in line
        for line in outcome.lines
    )


def test_over_cap_candidate_is_reported_not_rejected() -> None:
    # arrange: 21 recorded runs with no task directories
    runs = [run(f"2026-09-08-{1000 + i}-x") for i in range(21)]
    state = state_json("demo", runs)
    fs = make_fs("demo", json.loads(state), {})
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert: the rebuild reports the overage instead of refusing to run
    assert outcome.run_count == 21
    assert outcome.changed_count == 0
    assert [r["run_id"] for r in outcome.candidate["runs"]] == [
        f"2026-09-08-{1000 + i}-x" for i in range(21)
    ]
    text = "\n".join(outcome.lines)
    assert "21 runs, 0 would change" in text
    assert "above the default 20-run working bound" in text
    assert "tools.archive_state" in text


# --------------------------------------------------------------------------
# task_file recomputation and shared directories
# --------------------------------------------------------------------------


def test_task_file_recomputed_to_lowest_ordered_spec_on_disk() -> None:
    # arrange: recorded task file is gone; specs live only inside tracks
    state = state_json(
        "demo",
        [
            run(
                "2026-09-08-1000-x",
                task_file="tasks/2026-09-08--dir/gone.md",
            )
        ],
    )
    files = {
        "tasks/2026-09-08--dir/01-z/00-task.md": spec_file(
            "2026-09-08-1000-x", title="Z spec"
        ),
        "tasks/2026-09-08--dir/00-a/00-task.md": spec_file(
            "2026-09-08-1000-x", title="A spec"
        ),
        "tasks/2026-09-08--dir/00-a/04-extra-task.md": spec_file(
            "2026-09-08-1000-x", title="Extra spec"
        ),
        "tasks/2026-09-08--dir/00-a/01-investigate.md": report_file("investigate"),
    }
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert: root first, then tracks by directory name -> 00-a/00-task.md;
    # every other numbered file (including the other spec files) is a job
    rebuilt = outcome.candidate["runs"][0]
    assert rebuilt["task_file"] == "tasks/2026-09-08--dir/00-a/00-task.md"
    assert [job["job"] for job in rebuilt["jobs"]] == [
        "investigate",
        "extra-task",
        "task",
    ]
    assert rebuilt["jobs"][1]["report_file"] == (
        "tasks/2026-09-08--dir/00-a/04-extra-task.md"
    )
    assert rebuilt["jobs"][2]["report_file"] == "tasks/2026-09-08--dir/01-z/00-task.md"
    text_lines = "\n".join(outcome.lines)
    assert "task file changed:" in text_lines
    assert "+ record job extra-task (done) -> 00-a/04-extra-task.md" in text_lines
    assert "+ record job task (done) -> 01-z/00-task.md" in text_lines
    assert "additional spec file not recorded: 01-z/00-task.md" not in text_lines


def test_run_kept_when_its_directory_belongs_to_another_run() -> None:
    # arrange: two recorded runs whose paths point into one directory
    dir_name = "2026-09-08--shared"
    state = state_json(
        "demo",
        [
            run(
                "2026-09-08-1000-a",
                task_file=f"tasks/{dir_name}/00-task.md",
                jobs=[],
            ),
            run(
                "2026-09-08-1000-b",
                task_file=f"tasks/{dir_name}/00-task.md",
                jobs=[
                    {
                        "job": "investigate",
                        "status": "done",
                        "report_file": f"tasks/{dir_name}/01-investigate.md",
                    }
                ],
            ),
        ],
    )
    files = {
        f"tasks/{dir_name}/00-task.md": spec_file("2026-09-08-1000-a"),
        f"tasks/{dir_name}/01-investigate.md": report_file("investigate"),
    }
    document = json.loads(state)
    fs = make_fs("demo", document, files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(document)

    # assert: spec run_id 1000-a claims the dir; 1000-b is kept as recorded
    ids = [run_["run_id"] for run_ in outcome.candidate["runs"]]
    assert ids == ["2026-09-08-1000-a", "2026-09-08-1000-b"]
    a = next(r for r in outcome.candidate["runs"] if r["run_id"] == "2026-09-08-1000-a")
    assert [job["job"] for job in a["jobs"]] == ["investigate"]
    b = next(r for r in outcome.candidate["runs"] if r["run_id"] == "2026-09-08-1000-b")
    assert b == next(r for r in document["runs"] if r["run_id"] == "2026-09-08-1000-b")
    assert any(
        "kept as recorded (task directory" in line and "belongs to run" in line
        for line in outcome.lines
    )


def test_new_run_with_spec_inside_track_uses_nested_task_file() -> None:
    # arrange
    state = state_json("demo", [])
    dir_name = "2026-09-08--nested-spec"
    files = {
        f"tasks/{dir_name}/00-track/00-task.md": spec_file(
            "2026-09-08-1300-x", title="Nested"
        ),
        f"tasks/{dir_name}/00-track/01-work.md": report_file("work"),
    }
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert
    new_run = outcome.candidate["runs"][0]
    assert new_run["run_id"] == "2026-09-08-1300-x"
    assert new_run["task_file"] == f"tasks/{dir_name}/00-track/00-task.md"
    assert new_run["jobs"][0]["report_file"] == f"tasks/{dir_name}/00-track/01-work.md"


def test_new_run_defaults_status_when_spec_status_invalid() -> None:
    # arrange
    state = state_json("demo", [])
    dir_name = "2026-09-08--bad-status"
    spec = (
        "---\n"
        "run_id: 2026-09-08-1400-x\n"
        "created: 2026-09-08\n"
        "status: in-progress\n"  # not a valid run status
        "workflow: build\n"
        "---\n\n# Work\n"
    )
    files = {f"tasks/{dir_name}/00-task.md": spec}
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert
    new_run = outcome.candidate["runs"][0]
    assert new_run["status"] == "awaiting-approval"
    assert "default awaiting-approval" in "\n".join(outcome.lines)


# --------------------------------------------------------------------------
# StateStore round trip and project isolation
# --------------------------------------------------------------------------


def _round_trip_fs() -> tuple[Path, Filesystem, dict]:
    state, files = _chat_like_fixture()
    project_dir = ROOT / "projects/demo"
    all_files = {
        str(project_dir / "state.json"): json.dumps(state, indent=2),
        str(project_dir / "TASKS.md"): "stale\n",
        str(ROOT / "TASKS.md"): "stale root\n",
        str(ROOT / "projects/other/state.json"): json.dumps(
            {
                "project": "other",
                "path": "/work/other",
                "runs": [
                    {
                        "run_id": "2026-09-08-0500-x",
                        "title": "Other",
                        "status": "done",
                        "created": "2026-09-08T05:00:00",
                        "task_file": "tasks/2026-09-08--other/00-task.md",
                    }
                ],
                "archived": 0,
            }
        ),
    }
    for rel, text in files.items():
        all_files[str(ROOT / "projects/demo" / rel)] = text
    fs = Filesystem.create_null(files=all_files, directories=[str(ROOT / "projects")])
    return project_dir, fs, json.loads(json.dumps(state))


def test_state_store_round_trip_regenerates_indexes() -> None:
    # arrange
    project_dir, fs, _state = _round_trip_fs()
    store = StateStore.create_null(project_dir, filesystem=fs)
    rebuilder = ProjectStateRebuilder(project_dir, fs)

    # act
    outcome = rebuilder.rebuild(store.snapshot())
    committed = store.update(lambda _doc: outcome.candidate)

    # assert
    assert committed == outcome.candidate
    assert json.loads(fs.read_text(project_dir / "state.json")) == outcome.candidate
    project_index = fs.read_text(project_dir / "TASKS.md")
    assert "tracks: 00-investigate-structures, 01-characterization-tests" in project_index
    assert "[task]" in project_index
    root_index = fs.read_text(ROOT / "TASKS.md")
    assert "[demo](projects/demo/TASKS.md)" in root_index
    assert "other" in root_index


def test_rebuild_leaves_other_projects_untouched() -> None:
    # arrange
    project_dir, fs, _state = _round_trip_fs()
    store = StateStore.create_null(project_dir, filesystem=fs)
    rebuilder = ProjectStateRebuilder(project_dir, fs)
    other_before = fs.read_text(ROOT / "projects/other/state.json")

    # act
    outcome = rebuilder.rebuild(store.snapshot())
    store.update(lambda _doc: outcome.candidate)

    # assert
    assert fs.read_text(ROOT / "projects/other/state.json") == other_before


def test_rebuild_preserves_unknown_extension_fields() -> None:
    # arrange: recorded runs carry extension fields the rebuild cannot know
    dir_name = "2026-09-08--x"
    state = state_json(
        "demo",
        [
            {
                "run_id": "2026-09-08-1000-x",
                "title": "X",
                "status": "awaiting-approval",
                "created": "2026-09-08T10:00:00",
                "task_file": f"tasks/{dir_name}/00-task.md",
                "workspace": "/work",
                "run_extension": {"kept": True},
                "jobs": [
                    {
                        "job": "implement",
                        "status": "queued",
                        "job_extension": [1, 2],
                        "report_file": f"tasks/{dir_name}/01-implement.md",
                    }
                ],
            }
        ],
    )
    files = {
        f"tasks/{dir_name}/00-task.md": spec_file("2026-09-08-1000-x", status="done"),
        f"tasks/{dir_name}/01-implement.md": report_file(
            "implement", role="implementer"
        ),
    }
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert: validation (which runs inside rebuild) already accepted the
    # document; the extension values must survive untouched
    rebuilt = outcome.candidate["runs"][0]
    assert rebuilt["run_extension"] == {"kept": True}
    assert rebuilt["jobs"][0]["job_extension"] == [1, 2]

def test_archived_run_directory_left_untouched_not_reconstructed() -> None:
    # arrange: a task dir whose spec run_id is archived in history.jsonl
    state = state_json("demo", [])
    dir_name = "2026-09-05--archived-task"
    files = {
        f"tasks/{dir_name}/00-task.md": spec_file(
            "2026-09-05-1000-x",
            status="done",
            workflow="build",
            title="Archived work",
        ),
        f"tasks/{dir_name}/01-implement.md": report_file(
            "implement", role="implementer"
        ),
        "history.jsonl": json.dumps(
            {
                "run_id": "2026-09-05-1000-x",
                "title": "Archived work",
                "status": "cancelled",
                "workflow": "build",
                "created": "2026-09-05T10:00:00",
                "task_file": f"tasks/{dir_name}/00-task.md",
                "workspace": "/work",
                "jobs": [],
            }
        )
        + chr(10),
    }
    fs = make_fs("demo", json.loads(state), files)
    rebuilder = ProjectStateRebuilder(ROOT / "projects/demo", fs)

    # act
    outcome = rebuilder.rebuild(json.loads(state))

    # assert: no new run is reconstructed; the dir is left untouched
    assert outcome.run_count == 0
    assert outcome.changed_count == 0
    assert outcome.candidate["runs"] == []
