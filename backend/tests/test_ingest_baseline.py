import asyncio
from pathlib import Path

import pytest

from app import sqlite_store
from app.core import scanner as scanner_mod
from app.core.scanner import ingest_jobs
from app.platforms.registry import CoconalaAdapter, CrowdWorksAdapter, LancersAdapter


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.config.settings.job_scanner_db", str(tmp_path / "jobs.db"))
    sqlite_store.reset()
    sqlite_store.connect()
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


def test_first_crawl_records_existing_listings_without_queueing(db):
    result = asyncio.run(ingest_jobs([_job("1"), _job("2")], source=db))
    assert result["baseline"] is True
    assert result["baselined"] == 2
    assert result["queued"] == 0
    assert result["skipped_seen"] == 0
    jobs = sqlite_store.list_jobs()
    assert {j["external_job_id"] for j in jobs} == {"1", "2"}
    assert all(j["status"] == "RECORDED" for j in jobs)
    refreshed = sqlite_store.get_source(db["id"])
    assert refreshed["last_scanned_at"]


def test_empty_later_crawl_keeps_last_job_count(db):
    asyncio.run(ingest_jobs([_job("1")], source=db))
    source = sqlite_store.get_source(db["id"])
    assert source["last_job_count"] == 1
    asyncio.run(ingest_jobs([], source=source, parse_note="html_bytes=12 vue-container=no"))
    source = sqlite_store.get_source(db["id"])
    assert source["last_job_count"] == 1
    assert source["last_error"]
    assert sqlite_store.job_counts_by_source()[db["id"]] == 1


def test_later_crawl_queues_only_unseen_jobs(db):
    asyncio.run(ingest_jobs([_job("1"), _job("2")], source=db))
    source = sqlite_store.get_source(db["id"])
    result = asyncio.run(ingest_jobs([_job("1"), _job("2"), _job("3", "LP制作")], source=source))
    assert result["baseline"] is False
    assert result["skipped_seen"] == 2
    assert result["queued"] == 1
    assert result["created"] == 1
    jobs = {j["external_job_id"]: j for j in sqlite_store.list_jobs()}
    assert jobs["3"]["status"] == "QUEUED"
    assert jobs["1"]["status"] == "RECORDED"


def test_list_jobs_new_only_hides_baseline(db):
    asyncio.run(ingest_jobs([_job("1"), _job("2")], source=db))
    source = sqlite_store.get_source(db["id"])
    asyncio.run(ingest_jobs([_job("1"), _job("2"), _job("3")], source=source))
    assert {j["external_job_id"] for j in sqlite_store.list_jobs()} == {"1", "2", "3"}
    assert {j["external_job_id"] for j in sqlite_store.list_jobs(new_only=True)} == {"3"}


def test_list_jobs_pagination_and_count(db):
    asyncio.run(ingest_jobs([_job("1"), _job("2")], source=db))
    source = sqlite_store.get_source(db["id"])
    asyncio.run(ingest_jobs([_job("1"), _job("2"), _job("3"), _job("4"), _job("5")], source=source))
    assert sqlite_store.count_jobs(new_only=False) == 5
    assert sqlite_store.count_jobs(new_only=True) == 3
    all_new = sqlite_store.list_jobs(new_only=True, limit=10)
    page1 = sqlite_store.list_jobs(new_only=True, limit=2, offset=0)
    page2 = sqlite_store.list_jobs(new_only=True, limit=2, offset=2)
    assert [j["external_job_id"] for j in page1] == [j["external_job_id"] for j in all_new[:2]]
    assert [j["external_job_id"] for j in page2] == [j["external_job_id"] for j in all_new[2:]]
    assert {j["external_job_id"] for j in page1 + page2} == {"3", "4", "5"}
    assert sqlite_store.count_jobs(status="QUEUED", new_only=True) == 3
    assert sqlite_store.list_jobs(new_only=True, limit=2, offset=10) == []


def test_empty_first_crawl_does_not_complete_baseline(db):
    result = asyncio.run(ingest_jobs([], source=db))
    assert result["baseline"] is True
    source = sqlite_store.get_source(db["id"])
    assert source["last_scanned_at"] is None
    assert source["last_error"]


def test_bad_client_is_recorded_but_not_queued(db):
    asyncio.run(ingest_jobs([_job("1")], source=db))
    sqlite_store.update_control({"excluded_clients": ["acme"]})
    source = sqlite_store.get_source(db["id"])
    new_job = {
        "platform": "crowdworks",
        "external_job_id": "9",
        "url": "https://crowdworks.jp/public/jobs/9",
        "title": "新規",
        "client": "Acme Inc",
        "budget": "80,000円",
    }
    result = asyncio.run(ingest_jobs([new_job], source=source))
    assert result["baseline"] is False
    assert result["queued"] == 0
    assert result["skipped_bad_client"] == 1
    jobs = {j["external_job_id"]: j for j in sqlite_store.list_jobs()}
    assert jobs["9"]["status"] == "RECORDED"


def _events_for(job_id: str) -> list[str]:
    conn = sqlite_store.connect()
    rows = conn.execute(
        "select event from job_events where job_id = ? order by timestamp", (job_id,)
    ).fetchall()
    return [r["event"] for r in rows]


def test_baseline_does_not_discord(db, monkeypatch):
    sent = []

    async def capture(job):
        sent.append(job["external_job_id"])
        return True

    monkeypatch.setattr(scanner_mod, "notify_new_job", capture)
    result = asyncio.run(ingest_jobs([_job("1"), _job("2")], source=db))
    assert result["discorded"] == 0
    assert sent == []
    for job in sqlite_store.list_jobs():
        assert "DISCORD_SENT" not in _events_for(job["id"])
        assert "BASELINE" in _events_for(job["id"])


def test_later_new_job_writes_db_and_discords(db, monkeypatch):
    asyncio.run(ingest_jobs([_job("1")], source=db))
    sent = []

    async def capture(job):
        sent.append(job["external_job_id"])
        return True

    monkeypatch.setattr(scanner_mod, "notify_new_job", capture)
    source = sqlite_store.get_source(db["id"])
    result = asyncio.run(ingest_jobs([_job("1"), _job("2", "LP制作")], source=source))
    assert result["created"] == 1
    assert result["discorded"] == 1
    assert sent == ["2"]
    jobs = {j["external_job_id"]: j for j in sqlite_store.list_jobs()}
    assert "DISCORD_SENT" in _events_for(jobs["2"]["id"])
    assert "DISCORD_SENT" not in _events_for(jobs["1"]["id"])


def test_unmatched_new_job_still_discords(db, monkeypatch):
    asyncio.run(ingest_jobs([_job("1")], source=db))
    sqlite_store.update_source(db["id"], {"rules": {"keywords": ["zzzz-no-match"]}})
    sent = []

    async def capture(job):
        sent.append(job["external_job_id"])
        return True

    monkeypatch.setattr(scanner_mod, "notify_new_job", capture)
    source = sqlite_store.get_source(db["id"])
    result = asyncio.run(ingest_jobs([_job("2")], source=source))
    assert result["queued"] == 0
    assert result["created"] == 1
    assert result["discorded"] == 1
    assert sent == ["2"]


def test_failed_discord_retries_on_next_crawl(db, monkeypatch):
    asyncio.run(ingest_jobs([_job("1")], source=db))
    attempts = []

    async def flaky(job):
        attempts.append(job["external_job_id"])
        return len(attempts) >= 2

    monkeypatch.setattr(scanner_mod, "notify_new_job", flaky)
    source = sqlite_store.get_source(db["id"])
    first = asyncio.run(ingest_jobs([_job("2")], source=source))
    assert first["created"] == 1
    assert first["discorded"] == 0
    job = next(j for j in sqlite_store.list_jobs() if j["external_job_id"] == "2")
    assert "DISCORD_FAILED" in _events_for(job["id"])
    assert "DISCORD_SENT" not in _events_for(job["id"])

    source = sqlite_store.get_source(db["id"])
    second = asyncio.run(ingest_jobs([_job("2")], source=source))
    assert second["created"] == 0
    assert second["skipped_seen"] == 1
    assert second["discorded"] == 1
    assert attempts == ["2", "2"]
    assert "DISCORD_SENT" in _events_for(job["id"])


def test_bad_client_does_not_discord(db, monkeypatch):
    asyncio.run(ingest_jobs([_job("1")], source=db))
    sqlite_store.update_control({"excluded_clients": ["acme"]})
    sent = []

    async def capture(job):
        sent.append(job["external_job_id"])
        return True

    monkeypatch.setattr(scanner_mod, "notify_new_job", capture)
    source = sqlite_store.get_source(db["id"])
    result = asyncio.run(ingest_jobs([_job("9")], source=source))
    assert result["skipped_bad_client"] == 1
    assert result["discorded"] == 0
    assert sent == []


def test_crowdworks_listing_parser_extracts_job_ids():
    html = """
    <ul>
      <li><a href="/public/jobs/111">WordPress修正</a><span class="payment">20,000円</span></li>
      <li><a href="/public/jobs/222?ref=list">LP制作</a></li>
    </ul>
    """
    jobs = CrowdWorksAdapter().parse_listing(html, "https://crowdworks.jp/public/jobs/search")
    ids = {j.external_job_id for j in jobs}
    assert ids == {"111", "222"}
    assert all(j.url.startswith("https://crowdworks.jp/public/jobs/") for j in jobs)


def test_lancers_listing_parser_extracts_job_ids():
    html = """
    <div><a href="/work/detail/555">記事作成</a></div>
    """
    jobs = LancersAdapter().parse_listing(html, "https://www.lancers.jp/work/search")
    assert jobs[0].external_job_id == "555"
    assert jobs[0].url.endswith("/work/detail/555")


def test_crowdworks_vue_container_listings():
    import html as html_lib
    import json

    payload = {
        "isMobile": False,
        "searchResult": {
            "page": {"current_page": 1, "total_page": 163, "size": 50, "total_entries": 8126},
            "job_offers": [
                {
                    "job_offer": {
                        "id": 13423844,
                        "title": "Androidアプリの通信解析",
                        "expired_on": "2026-09-10",
                        "last_released_at": "2026-09-03T10:37:51+09:00",
                    },
                    "client": {"username": "studio-k", "is_employer_certification": True},
                    "payment": {"fixed_price_payment": {"min_budget": 30000, "max_budget": 80000}},
                }
            ]
        },
    }
    escaped = html_lib.escape(json.dumps(payload), quote=True)
    page = f'<div id="vue-container" data="{escaped}"></div>'
    adapter = CrowdWorksAdapter()
    jobs = adapter.parse_listing(page, "https://crowdworks.jp/public/jobs/search?category_id=226&order=new")
    assert len(jobs) == 1
    assert jobs[0].external_job_id == "13423844"
    assert jobs[0].title == "Androidアプリの通信解析"
    assert jobs[0].client == "studio-k"
    assert jobs[0].budget == "30,000円〜80,000円"
    assert jobs[0].url == "https://crowdworks.jp/public/jobs/13423844"
    assert adapter.last_meta.get("total_entries") == 8126
    assert adapter.last_meta.get("parsed") == 1
    assert jobs[0].extra.get("verified") is True
    assert jobs[0].extra.get("hourly") is False
    assert jobs[0].extra.get("posted_at") == "2026-09-03T10:37:51+09:00"


def test_coconala_listing_reads_posted_title():
    html = """
    <article>
      <a href="/requests/5249264">リール動画</a>
      <span title="2026年9月3日 木曜日 08:16">2時間前</span>
    </article>
    """
    jobs = CoconalaAdapter().parse_listing(html, "https://coconala.com/requests?sort_by=new")
    assert jobs[0].external_job_id == "5249264"
    assert jobs[0].extra.get("posted_at") == "2026年9月3日 木曜日 08:16"


def test_crowdworks_search_links_without_ids_are_ignored():
    html = """
    <html>
      <a href="https://crowdworks.jp/public/jobs/search?order=new">search</a>
    </html>
    """
    assert CrowdWorksAdapter().parse_listing(html, "https://crowdworks.jp/public/jobs/search") == []


def test_claim_next_stops_at_max_active(db, monkeypatch):
    from app.core.scanner import claim_next_job

    asyncio.run(ingest_jobs([_job("1")], source=db))
    source = sqlite_store.get_source(db["id"])
    asyncio.run(ingest_jobs([_job("1"), _job("2"), _job("3"), _job("4")], source=source))
    sqlite_store.update_bider_settings({"enabled": True, "mode": "semi-auto", "max_active_jobs": 2})
    monkeypatch.setattr("app.store.active_job_count", sqlite_store.active_job_count)
    monkeypatch.setattr("app.store.update_job", sqlite_store.update_job)
    monkeypatch.setattr("app.store.queued_jobs", sqlite_store.queued_jobs)
    first = claim_next_job()
    second = claim_next_job()
    third = claim_next_job()
    assert first and second
    assert {first["external_job_id"], second["external_job_id"]} <= {"2", "3", "4"}
    assert third is None
    assert sqlite_store.active_job_count() == 2


def test_collect_next_jobs_returns_inflight_when_cap_reached(db, monkeypatch):
    from app.core.scanner import bider_payload, claim_next_job, collect_next_jobs

    asyncio.run(ingest_jobs([_job("1")], source=db))
    source = sqlite_store.get_source(db["id"])
    asyncio.run(ingest_jobs([_job("1"), _job("2"), _job("3")], source=source))
    sqlite_store.update_bider_settings({"enabled": True, "mode": "semi-auto", "max_active_jobs": 1})
    monkeypatch.setattr("app.store.active_job_count", sqlite_store.active_job_count)
    monkeypatch.setattr("app.store.update_job", sqlite_store.update_job)
    monkeypatch.setattr("app.store.queued_jobs", sqlite_store.queued_jobs)
    monkeypatch.setattr("app.store.active_jobs", sqlite_store.active_jobs)
    first = claim_next_job()
    assert first
    again = collect_next_jobs(3)
    assert [j["id"] for j in again] == [first["id"]]
    assert again[0]["url"] == first["url"]
    assert "posted_at" in bider_payload(first)


def test_collect_next_jobs_force_claims_when_paused(db, monkeypatch):
    from app.core.scanner import claim_next_job, collect_next_jobs

    asyncio.run(ingest_jobs([_job("1")], source=db))
    source = sqlite_store.get_source(db["id"])
    asyncio.run(ingest_jobs([_job("1"), _job("2"), _job("3")], source=source))
    sqlite_store.update_bider_settings({"enabled": False, "mode": "paused", "max_active_jobs": 2})
    monkeypatch.setattr("app.store.active_job_count", sqlite_store.active_job_count)
    monkeypatch.setattr("app.store.update_job", sqlite_store.update_job)
    monkeypatch.setattr("app.store.queued_jobs", sqlite_store.queued_jobs)
    monkeypatch.setattr("app.store.active_jobs", sqlite_store.active_jobs)
    assert claim_next_job() is None
    jobs = collect_next_jobs(2, force=True)
    assert len(jobs) == 2
    assert all(j.get("url") for j in jobs)


def test_two_actors_can_claim_the_same_job_url(db, monkeypatch):
    from app.core.scanner import claim_next_job

    asyncio.run(ingest_jobs([_job("1")], source=db))
    source = sqlite_store.get_source(db["id"])
    asyncio.run(ingest_jobs([_job("1"), _job("2")], source=source))
    sqlite_store.update_bider_settings({"enabled": True, "mode": "semi-auto", "max_active_jobs": 1})
    monkeypatch.setattr("app.store.active_job_count", sqlite_store.active_job_count)
    monkeypatch.setattr("app.store.update_job", sqlite_store.update_job)
    monkeypatch.setattr("app.store.queued_jobs", sqlite_store.queued_jobs)
    monkeypatch.setattr("app.store.upsert_claim", sqlite_store.upsert_claim)
    monkeypatch.setattr("app.store.actor_active_count", sqlite_store.actor_active_count)
    monkeypatch.setattr("app.store.queued_for_actor", sqlite_store.queued_for_actor)
    alice = claim_next_job(force=True, actor="alice")
    assert alice
    assert claim_next_job(force=True, actor="alice") is None
    bob = claim_next_job(force=True, actor="bob")
    assert bob
    assert alice["url"] == bob["url"]
    assert sqlite_store.actor_active_count("alice") == 1
    assert sqlite_store.actor_active_count("bob") == 1


def test_yesterday_claim_does_not_block_today(db, monkeypatch):
    from app.core.scanner import claim_next_job

    asyncio.run(ingest_jobs([_job("1")], source=db))
    source = sqlite_store.get_source(db["id"])
    asyncio.run(ingest_jobs([_job("1"), _job("2")], source=source))
    sqlite_store.update_bider_settings({"enabled": True, "mode": "semi-auto", "max_active_jobs": 1})
    monkeypatch.setattr("app.store.active_job_count", sqlite_store.active_job_count)
    monkeypatch.setattr("app.store.update_job", sqlite_store.update_job)
    monkeypatch.setattr("app.store.queued_jobs", sqlite_store.queued_jobs)
    monkeypatch.setattr("app.store.upsert_claim", sqlite_store.upsert_claim)
    monkeypatch.setattr("app.store.actor_active_count", sqlite_store.actor_active_count)
    monkeypatch.setattr("app.store.queued_for_actor", sqlite_store.queued_for_actor)
    first = claim_next_job(force=True, actor="alice")
    assert first
    sqlite_store.upsert_claim(first["id"], "alice", "SKIPPED", first.get("url"))
    conn = sqlite_store.connect()
    conn.execute("update bider_claims set day = '2020-01-01' where actor = 'alice'")
    conn.commit()
    again = claim_next_job(force=True, actor="alice")
    assert again and again["id"] == first["id"]


def test_list_jobs_includes_status_at_for_processing(db):
    job = sqlite_store.insert_job(
        {
            "platform": "crowdworks",
            "external_job_id": "status-age-1",
            "url": "https://crowdworks.jp/public/jobs/status-age-1",
            "title": "timer job",
            "status": "PROCESSING",
        }
    )
    sqlite_store.add_event(job["id"], "PROCESSING")
    listed = sqlite_store.list_jobs(new_only=False)
    row = next(j for j in listed if j["id"] == job["id"])
    assert row["status"] == "PROCESSING"
    assert row["status_at"]
