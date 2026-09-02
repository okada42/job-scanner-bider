from datetime import datetime, timezone

from app.core.fetch import fetch_html
from app.core.rules import client_is_excluded, job_matches
from app.integrations.discord import notify_new_job
from app.integrations.hub import hub
from app.platforms.registry import ADAPTERS
from app.store import (
    add_event,
    find_job,
    get_bider_settings,
    get_control,
    get_source,
    insert_job,
    queued_jobs,
    update_source,
)


def bider_payload(job: dict) -> dict:
    return {
        "id": job["id"],
        "platform": job["platform"],
        "url": job["url"],
        "title": job.get("title"),
        "budget": job.get("budget"),
        "client": job.get("client"),
        "deadline": job.get("deadline"),
        "status": job.get("status"),
    }


def _item_dict(item) -> dict:
    if isinstance(item, dict):
        return item
    if hasattr(item, "model_dump"):
        return item.model_dump()
    keys = (
        "platform",
        "external_job_id",
        "url",
        "title",
        "client",
        "budget",
        "deadline",
        "application_count",
        "category",
        "source_id",
    )
    return {k: getattr(item, k, None) for k in keys}


def is_first_scan(source: dict | None) -> bool:
    return bool(source) and not source.get("last_scanned_at")


async def ingest_jobs(items: list, *, source: dict | None = None, baseline: bool | None = None) -> dict:
    """Crawl ingest: remember every job id, alert only on listings never stored before.

    First successful parse of a source is a baseline: jobs already on the page are
    stored as seen and ignored (no Discord, no bider queue). Later crawls treat a
    job as new only if (platform, external_job_id) or URL is not already in the DB.
    """
    created = 0
    queued = 0
    baselined = 0
    skipped_seen = 0
    skipped_bad_client = 0
    first_scan = is_first_scan(source) if baseline is None else baseline
    settings = get_bider_settings()
    excluded_clients = (get_control() or {}).get("excluded_clients") or []
    max_queue = int(settings.get("max_queue_size") or 100)
    default_source_id = source["id"] if source else None
    default_rules = (source or {}).get("rules") or {}
    source_cache: dict[str, dict | None] = {}
    if source:
        source_cache[str(source["id"])] = source
    touched_ids: set[str] = set()

    for raw in items:
        item = _item_dict(raw)
        platform = item.get("platform")
        external_id = item.get("external_job_id")
        url = item.get("url")
        if not platform or not external_id or not url:
            continue
        sid = item.get("source_id") or default_source_id
        rules = default_rules
        if sid:
            key = str(sid)
            touched_ids.add(key)
            if key not in source_cache:
                source_cache[key] = get_source(key)
            extra = source_cache.get(key)
            if extra is not None:
                rules = extra.get("rules") or {}
        if find_job(platform, str(external_id), url):
            skipped_seen += 1
            continue
        row = {
            "platform": platform,
            "external_job_id": str(external_id),
            "url": url,
            "title": item.get("title"),
            "client": item.get("client"),
            "budget": item.get("budget"),
            "deadline": item.get("deadline"),
            "application_count": item.get("application_count"),
            "category": item.get("category"),
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "status": "RECORDED",
            "matched": False,
        }
        if sid:
            row["source_id"] = str(sid)

        if first_scan:
            try:
                job = insert_job(row)
            except Exception:
                continue
            created += 1
            baselined += 1
            add_event(job["id"], "BASELINE", {"reason": "already_listed_on_first_crawl"})
            continue

        if client_is_excluded(row.get("client"), excluded_clients):
            try:
                job = insert_job(row)
            except Exception:
                continue
            created += 1
            skipped_bad_client += 1
            add_event(job["id"], "SKIPPED", {"reason": "bad_client", "client": row.get("client")})
            continue

        matched, reason = job_matches(row, rules)
        row["matched"] = matched
        if matched and len(queued_jobs(max_queue)) < max_queue:
            row["status"] = "QUEUED"
        try:
            job = insert_job(row)
        except Exception:
            continue
        created += 1
        add_event(job["id"], "RECORDED", {"reason": reason, "matched": matched})
        if job["status"] == "QUEUED":
            queued += 1
            add_event(job["id"], "QUEUED", {"reason": reason})
            await notify_new_job(job)
            await hub.broadcast({"event": "NEW_JOB", "job": bider_payload(job)})

    stamp = {
        "last_error": None,
        "last_job_count": len(items),
    }
    if first_scan and not items:
        stamp["last_error"] = (
            "First crawl parsed 0 jobs (login wall or empty listing). "
            "Baseline not complete; existing listings will not be treated as new yet."
        )
    else:
        stamp["last_scanned_at"] = datetime.now(timezone.utc).isoformat()

    if source:
        update_source(source["id"], stamp)
    else:
        for sid in touched_ids:
            if get_source(sid):
                update_source(sid, stamp)

    return {
        "found": len(items),
        "created": created,
        "queued": queued,
        "baselined": baselined,
        "skipped_seen": skipped_seen,
        "skipped_bad_client": skipped_bad_client,
        "baseline": first_scan,
    }


async def scan_source(source: dict) -> dict:
    adapter = ADAPTERS[source["platform"]]
    html = await fetch_html(source["url"])
    extracted = adapter.parse_listing(html, source["url"])
    return await ingest_jobs(extracted, source=source)


def claim_next_job() -> dict | None:
    from app.store import active_job_count, update_job

    settings = get_bider_settings()
    if not settings.get("enabled") or settings.get("mode") == "paused":
        return None
    if active_job_count() >= int(settings.get("max_active_jobs") or 1):
        return None
    pending = queued_jobs(1)
    if not pending:
        return None
    job = update_job(pending[0]["id"], {"status": "SENT_TO_BIDER"})
    add_event(job["id"], "SENT_TO_BIDER")
    return job
