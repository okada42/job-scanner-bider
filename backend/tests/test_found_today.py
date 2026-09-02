import asyncio
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app import sqlite_store
from app.api import scanners as scanners_mod
from app.core.clock import local_day_start, local_day_start_iso
from app.core.scanner import ingest_jobs

JST = ZoneInfo("Asia/Tokyo")


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.config.settings.job_scanner_db", str(tmp_path / "jobs.db"))
    sqlite_store.reset()
    sqlite_store.connect()
    from app.core import scanner as scanner_mod

    for name in (
        "find_job",
        "insert_job",
        "add_event",
        "queued_jobs",
        "get_bider_settings",
        "get_source",
        "update_source",
        "get_control",
        "jobs_failed_discord",
    ):
        monkeypatch.setattr(scanner_mod, name, getattr(sqlite_store, name))

    async def _no_discord(*_a, **_k):
        return True

    monkeypatch.setattr(scanner_mod, "notify_new_job", _no_discord)
    source = sqlite_store.insert_source(
        {
            "name": "cw search",
            "platform": "crowdworks",
            "url": "https://crowdworks.jp/public/jobs/search",
            "enabled": True,
            "scan_interval": 20,
            "rules": {},
        }
    )
    yield source
    sqlite_store.reset()


def _job(jid: str, title: str = "Web開発") -> dict:
    return {
        "platform": "crowdworks",
        "external_job_id": jid,
        "url": f"https://crowdworks.jp/public/jobs/{jid}",
        "title": title,
        "client": "Acme",
        "budget": "50,000円",
    }


def test_local_day_start_is_tokyo_midnight():
    # 2026-09-03 00:30 JST == 2026-09-02 15:30 UTC
    now = datetime(2026, 9, 2, 15, 30, tzinfo=timezone.utc)
    start = local_day_start(now)
    local = start.astimezone(JST)
    assert local.year == 2026 and local.month == 9 and local.day == 3
    assert local.hour == 0 and local.minute == 0
    before = datetime(2026, 9, 2, 14, 59, tzinfo=timezone.utc)
    early = local_day_start(before).astimezone(JST)
    assert early.day == 2


def test_found_counts_jobs_recorded_today_then_resets(db, monkeypatch):
    asyncio.run(ingest_jobs([_job("1"), _job("2")], source=db))
    sid = db["id"]
    today = local_day_start_iso()
    # First crawl is a baseline: those listings do not count as Found today.
    assert sqlite_store.job_counts_since_by_source(today).get(sid, 0) == 0

    source = sqlite_store.get_source(sid)
    asyncio.run(ingest_jobs([_job("1"), _job("2"), _job("3")], source=source))
    assert sqlite_store.job_counts_since_by_source(today)[sid] == 1

    yesterday = datetime(2020, 1, 1, tzinfo=timezone.utc).isoformat()
    conn = sqlite_store.connect()
    conn.execute("update jobs set created_at = ? where external_job_id = ?", (yesterday, "3"))
    conn.commit()
    assert sqlite_store.job_counts_since_by_source(today).get(sid, 0) == 0

    source = sqlite_store.get_source(sid)
    asyncio.run(ingest_jobs([_job("4")], source=source))
    assert sqlite_store.job_counts_since_by_source(today)[sid] == 1

    monkeypatch.setattr(scanners_mod, "job_counts_by_source", sqlite_store.job_counts_by_source)
    monkeypatch.setattr(scanners_mod, "job_counts_since_by_source", sqlite_store.job_counts_since_by_source)
    monkeypatch.setattr(scanners_mod, "list_sources", sqlite_store.list_sources)
    rows = {s["id"]: s for s in scanners_mod._sources_with_found()}
    assert rows[sid]["found"] == 1
    assert rows[sid]["job_count"] == 4
