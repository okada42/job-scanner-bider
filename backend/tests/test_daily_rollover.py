from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import sqlite_store
from app.core import scheduler as scheduler_mod
from app.core.clock import local_day_start_iso


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.config.settings.job_scanner_db", str(tmp_path / "jobs.db"))
    sqlite_store.reset()
    sqlite_store.connect()
    yield
    sqlite_store.reset()


def _insert(jid: str, status: str, detected_at: str, priority: int = 0) -> dict:
    return sqlite_store.insert_job(
        {
            "platform": "crowdworks",
            "external_job_id": jid,
            "url": f"https://crowdworks.jp/public/jobs/{jid}",
            "title": f"job {jid}",
            "status": status,
            "detected_at": detected_at,
            "priority": priority,
        }
    )


def _yesterday() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).isoformat()


def test_queue_only_returns_jobs_detected_today(db):
    _insert("old-q", "QUEUED", _yesterday())
    _insert("old-p", "PROCESSING", _yesterday())
    new = _insert("new-q", "QUEUED", _today())
    _insert("new-p", "PROCESSING", _today())

    assert [j["external_job_id"] for j in sqlite_store.queued_jobs(10)] == ["new-q"]
    # Per-user pool includes jobs other users hold, but never yesterday's.
    assert {j["external_job_id"] for j in sqlite_store.queued_for_actor("kenji", 10)} == {"new-q", "new-p"}
    assert sqlite_store.active_job_count() == 1
    assert [j["external_job_id"] for j in sqlite_store.active_jobs(10)] == ["new-p"]
    assert new["status"] == "QUEUED"


def test_rollover_expires_stale_bider_jobs_and_keeps_today(db):
    _insert("old-q", "QUEUED", _yesterday())
    _insert("old-p", "PROCESSING", _yesterday())
    _insert("old-done", "COMPLETED", _yesterday())
    _insert("old-skip", "SKIPPED", _yesterday())
    _insert("new-q", "QUEUED", _today())

    expired = sqlite_store.expire_stale_bider_jobs(local_day_start_iso())
    assert len(expired) == 2

    by_id = {j["external_job_id"]: j["status"] for j in sqlite_store.list_jobs(limit=50)}
    assert by_id["old-q"] == "EXPIRED"
    assert by_id["old-p"] == "EXPIRED"
    assert by_id["old-done"] == "COMPLETED"
    assert by_id["old-skip"] == "SKIPPED"
    assert by_id["new-q"] == "QUEUED"

    events = sqlite_store.connect().execute("select count(*) as n from job_events where event = 'EXPIRED'").fetchone()
    assert int(events["n"]) == 2

    # Dashboard default view hides expired rows but reports how many there are.
    visible = sqlite_store.list_jobs(limit=50, exclude_status="EXPIRED")
    assert {j["external_job_id"] for j in visible} == {"old-done", "old-skip", "new-q"}
    assert sqlite_store.count_jobs(exclude_status="EXPIRED") == 3
    assert sqlite_store.count_jobs(status="EXPIRED") == 2

    # Second pass is a no-op.
    assert sqlite_store.expire_stale_bider_jobs(local_day_start_iso()) == []


def test_scheduler_rolls_over_once_per_day(db, monkeypatch):
    _insert("old-q", "QUEUED", _yesterday())
    monkeypatch.setattr(scheduler_mod, "expire_stale_bider_jobs", sqlite_store.expire_stale_bider_jobs)
    monkeypatch.setattr(scheduler_mod, "_rolled_day", None)

    assert scheduler_mod.rollover_if_new_day() == 1
    assert scheduler_mod.rollover_if_new_day() is None
    info = scheduler_mod.last_rollover()
    assert info["expired"] == 1 and info["error"] is None

    _insert("old-q2", "QUEUED", _yesterday())
    assert scheduler_mod.rollover_if_new_day(force=True) == 1
