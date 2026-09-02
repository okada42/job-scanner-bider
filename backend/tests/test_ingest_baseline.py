import asyncio
from pathlib import Path

import pytest

from app import sqlite_store
from app.core import scanner as scanner_mod
from app.core.scanner import ingest_jobs
from app.platforms.registry import CrowdWorksAdapter, LancersAdapter


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
    ):
        monkeypatch.setattr(scanner_mod, name, getattr(sqlite_store, name))

    async def _no_discord(*_a, **_k):
        return None

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
            "job_offers": [
                {
                    "job_offer": {
                        "id": 13423844,
                        "title": "Androidアプリの通信解析",
                        "expired_on": "2026-09-10",
                    },
                    "client": {"username": "studio-k"},
                    "payment": {"fixed_price_payment": {"min_budget": 30000, "max_budget": 80000}},
                }
            ]
        },
    }
    escaped = html_lib.escape(json.dumps(payload), quote=True)
    page = f'<div id="vue-container" data="{escaped}"></div>'
    jobs = CrowdWorksAdapter().parse_listing(page, "https://crowdworks.jp/public/jobs/search?order=new")
    assert len(jobs) == 1
    assert jobs[0].external_job_id == "13423844"
    assert jobs[0].title == "Androidアプリの通信解析"
    assert jobs[0].client == "studio-k"
    assert jobs[0].budget == "30,000円〜80,000円"
    assert jobs[0].url == "https://crowdworks.jp/public/jobs/13423844"


def test_crowdworks_search_links_without_ids_are_ignored():
    html = """
    <html>
      <a href="https://crowdworks.jp/public/jobs/search?order=new">search</a>
    </html>
    """
    assert CrowdWorksAdapter().parse_listing(html, "https://crowdworks.jp/public/jobs/search") == []
