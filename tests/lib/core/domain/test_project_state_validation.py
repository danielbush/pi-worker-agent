"""Tests for strict raw project-state validation and extension preservation."""

from __future__ import annotations

import pytest

from tools.lib.core.domain.project_state_validation import (
    ProjectStateValidationError,
    validate_project_state,
)


def _valid_document() -> dict:
    return {
        "project": "demo",
        "path": "/work/demo",
        "archived": 0,
        "runs": [
            {
                "run_id": "run-1",
                "title": "Build it",
                "workflow": "build",
                "status": "running",
                "created": "2026-09-07T12:00:00+10:00",
                "task_file": "runs/run-1/00-task.md",
                "workspace": "/work/demo",
                "jobs": [{"job": "implement", "status": "queued"}],
            }
        ],
    }


def test_collects_duplicate_status_timestamp_type_and_path_issues() -> None:
    # arrange
    document = _valid_document()
    duplicate = dict(document["runs"][0])
    duplicate.update(
        {
            "status": "mystery",
            "created": "not-a-date",
            "task_file": "../outside.md",
            "jobs": [{"job": "review", "status": 4}],
        }
    )
    document["runs"].append(duplicate)
    document["archived"] = True

    # act
    with pytest.raises(ProjectStateValidationError) as caught:
        validate_project_state(document, "demo", baseline=document)

    # assert
    message = str(caught.value)
    assert "archived: expected non-negative integer" in message
    assert "runs[1].run_id: duplicate value 'run-1'" in message
    assert "runs[1].status: unknown run status 'mystery'" in message
    assert "runs[1].created: expected ISO timestamp" in message
    assert "runs[1].task_file: expected safe project-relative path" in message
    assert "runs[1].jobs[0].status: expected non-empty string" in message


def test_existing_unknown_values_are_immutable_and_new_unknowns_are_rejected() -> None:
    # arrange
    baseline = _valid_document()
    baseline["extension"] = {"kept": True}
    baseline["runs"][0]["run_extension"] = [1, 2]
    baseline["runs"][0]["jobs"][0]["job_extension"] = "old"
    candidate = _valid_document()
    candidate["extension"] = {"kept": False}
    candidate["new_top_typo"] = True
    candidate["runs"][0]["new_run_typo"] = True
    candidate["runs"][0]["jobs"][0]["job_extension"] = "old"
    candidate["runs"][0]["jobs"][0]["new_job_typo"] = True

    # act
    with pytest.raises(ProjectStateValidationError) as caught:
        validate_project_state(candidate, "demo", baseline=baseline)

    # assert
    assert caught.value.issues == (
        "new_top_typo: newly introduced unknown field",
        "extension: pre-existing unknown value must be preserved",
        "runs[0].new_run_typo: newly introduced unknown field",
        "runs[0].run_extension: pre-existing unknown field must be preserved",
        "runs[0].jobs[0].new_job_typo: newly introduced unknown field",
    )


def test_session_id_is_optional_and_must_be_a_string_when_present() -> None:
    # arrange
    without_session = _valid_document()
    with_session = _valid_document()
    with_session["runs"][0]["jobs"][0]["session_id"] = "sess-harness-1"
    with_session["runs"][0]["jobs"].append(
        {
            "job": "review",
            "status": "queued",
            "harness_session": "alias-still-in-real-state",
        }
    )
    invalid = _valid_document()
    invalid["runs"][0]["jobs"][0]["session_id"] = 12

    # act / assert
    validate_project_state(without_session, "demo")
    validate_project_state(with_session, "demo")
    with pytest.raises(ProjectStateValidationError) as caught:
        validate_project_state(invalid, "demo")
    assert caught.value.issues == (
        "runs[0].jobs[0].session_id: expected string",
    )
