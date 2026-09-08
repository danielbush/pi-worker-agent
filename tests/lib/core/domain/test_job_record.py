"""Tests for JobRecord."""

from __future__ import annotations

from tools.lib.core.domain.job_record import JobRecord


def test_parses_index_fields_and_owns_persisted_field_names() -> None:
    # arrange
    payload = {"job": "implement", "status": "running", "attempt": 3}

    # act
    record = JobRecord.from_dict(payload)

    # assert
    assert record == JobRecord(job="implement", status="running")
    assert {
        "job",
        "status",
        "attempt",
        "harness",
        "session_id",
        "harness_session",
    } <= JobRecord.KNOWN_FIELDS


def test_skips_non_object_payload() -> None:
    assert JobRecord.from_dict("implement") is None


def test_parses_report_file_for_track_index_rendering() -> None:
    # arrange
    payload = {
        "job": "implement",
        "status": "done",
        "report_file": "tasks/2026-09-08--slug/00-track/01-implement.md",
    }

    # act
    record = JobRecord.from_dict(payload)

    # assert
    assert record is not None
    assert record.report_file == (
        "tasks/2026-09-08--slug/00-track/01-implement.md"
    )


def test_missing_report_file_stays_none() -> None:
    # arrange
    payload = {"job": "implement", "status": "queued"}

    # act
    record = JobRecord.from_dict(payload)

    # assert
    assert record is not None
    assert record.report_file is None
