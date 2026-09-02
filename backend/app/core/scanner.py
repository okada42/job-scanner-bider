from datetime import datetime, timezone

from app.core.fetch import fetch_html
from app.core.rules import job_matches
from app.integrations.discord import notify_new_job
from app.integrations.hub import hub
from app.platforms.registry import ADAPTERS
from app.store import (
    add_event,
    find_job,
    get_bider_settings,
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


async def ingest_jobs(items: list, *, source: dict | None = None) -> dict:
    """Shared insert / dedupe / rules / Discord / queue path for HTML scan and extension ingest."""
    created = 0
    queued = 0
    settings = get_bider_settings()
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
        "last_scanned_at": datetime.now(timezone.utc).isoformat(),
        "last_error": None,
        "last_job_count": len(items),
    }
    if source:
        update_source(source["id"], stamp)
    else:
        for sid in touched_ids:
            if get_source(sid):
                update_source(sid, stamp)

    return {"found": len(items), "created": created, "queued": queued}


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
