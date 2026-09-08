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
    assert {"job", "status", "attempt", "harness"} <= JobRecord.KNOWN_FIELDS


def test_skips_non_object_payload() -> None:
    assert JobRecord.from_dict("implement") is None
