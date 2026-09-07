"""Tests for RunRecord."""

from __future__ import annotations

from tools.lib.domain.job_record import JobRecord
from tools.lib.domain.run_record import RunRecord


def test_parses_nested_jobs_and_owns_persisted_field_names() -> None:
    # arrange
    payload = {
        "run_id": "run-1",
        "status": "running",
        "workspace": "/work/demo",
        "jobs": [{"job": "implement", "status": "done"}, "invalid"],
    }

    # act
    record = RunRecord.from_dict("demo", payload)

    # assert
    assert record is not None
    assert record.project == "demo"
    assert record.workspace == "/work/demo"
    assert record.jobs == [JobRecord(job="implement", status="done")]
    assert {"run_id", "status", "jobs", "review_failures"} <= RunRecord.KNOWN_FIELDS


def test_skips_non_object_payload() -> None:
    assert RunRecord.from_dict("demo", ["invalid"]) is None
