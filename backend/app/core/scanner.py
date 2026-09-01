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


async def scan_source(source: dict) -> dict:
    adapter = ADAPTERS[source["platform"]]
    html = await fetch_html(source["url"])
    extracted = adapter.parse_listing(html, source["url"])
    created = 0
    queued = 0
    rules = source.get("rules") or {}
    settings = get_bider_settings()
    max_queue = int(settings.get("max_queue_size") or 100)

    for item in extracted:
        if find_job(item.platform, item.external_job_id, item.url):
            continue
        row = {
            "platform": item.platform,
            "external_job_id": item.external_job_id,
            "url": item.url,
            "title": item.title,
            "client": item.client,
            "budget": item.budget,
            "deadline": item.deadline,
            "application_count": item.application_count,
            "category": item.category,
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "status": "RECORDED",
            "matched": False,
            "source_id": source["id"],
        }
        matched, reason = job_matches(row, rules)
        row["matched"] = matched
        if matched and len(queued_jobs(max_queue)) < max_queue:
            row["status"] = "QUEUED"
        job = insert_job(row)
        created += 1
        add_event(job["id"], "RECORDED", {"reason": reason, "matched": matched})
        if job["status"] == "QUEUED":
            queued += 1
            add_event(job["id"], "QUEUED", {"reason": reason})
            await notify_new_job(job)
            await hub.broadcast({"event": "NEW_JOB", "job": bider_payload(job)})

    update_source(
        source["id"],
        {
            "last_scanned_at": datetime.now(timezone.utc).isoformat(),
            "last_error": None,
            "last_job_count": len(extracted),
        },
    )
    return {"found": len(extracted), "created": created, "queued": queued}


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
