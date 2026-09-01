from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import get_settings
from app.db import db
from app.platforms import adapter_for, detect_platform
from app.platforms.base import fetch_html
from app.realtime import hub
from app.scanner.budget import parse_budget_range
from app.scanner.dedupe import find_existing
from app.scanner.queue import maybe_dispatch, settings_row
from app.scanner.rules import job_matches
from app.integrations.discord import notify_new_job

_scheduler: AsyncIOScheduler | None = None
_lock = asyncio.Lock()


def _now():
    return datetime.now(timezone.utc)


def control_row() -> dict[str, Any]:
    res = db().table("scanner_control").select("*").eq("id", 1).limit(1).execute()
    if res.data:
        return res.data[0]
    return {"overall_enabled": False, "platform_enabled": {}}


def platform_on(control: dict[str, Any], platform: str) -> bool:
    flags = control.get("platform_enabled") or {}
    return bool(flags.get(platform, True))


def due(source: dict[str, Any]) -> bool:
    interval = int(source.get("scan_interval") or get_settings().default_scan_interval_seconds)
    last = source.get("last_scanned_at")
    if not last:
        return True
    if isinstance(last, str):
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
    else:
        last_dt = last
    return (_now() - last_dt).total_seconds() >= interval


async def tick():
    if _lock.locked():
        return
    async with _lock:
        control = await asyncio.to_thread(control_row)
        if not control.get("overall_enabled"):
            return
        res = await asyncio.to_thread(lambda: db().table("scanner_sources").select("*").eq("enabled", True).execute())
        for source in res.data or []:
            if not platform_on(control, source["platform"]):
                continue
            if not due(source):
                continue
            try:
                await scan_source(source)
            except Exception as exc:
                await asyncio.to_thread(
                    lambda s=source, e=str(exc): db()
                    .table("scanner_sources")
                    .update({"last_error": e, "last_scanned_at": _now().isoformat()})
                    .eq("id", s["id"])
                    .execute()
                )


async def scan_source(source: dict[str, Any]) -> dict[str, Any]:
    html = await fetch_html(source["url"])
    adapter = adapter_for(source["platform"])
    drafts = adapter.parse(html, source["url"])
    created = 0
    queued = 0
    settings = await asyncio.to_thread(settings_row)
    max_queue = int(settings.get("max_queue_size") or 50)

    for draft in drafts:
        payload = {
            "platform": draft.platform,
            "external_job_id": draft.external_job_id,
            "url": draft.url,
            "title": draft.title,
            "client": draft.client,
            "budget": draft.budget,
            "deadline": draft.deadline,
            "application_count": draft.application_count,
            "category": draft.category,
            "detected_at": draft.detected_at.replace(tzinfo=timezone.utc).isoformat()
            if draft.detected_at.tzinfo is None
            else draft.detected_at.isoformat(),
        }
        bmin, bmax = parse_budget_range(draft.budget)
        payload["budget_min"] = bmin
        payload["budget_max"] = bmax

        existing = await asyncio.to_thread(
            find_existing, draft.platform, draft.external_job_id, draft.url
        )
        if existing:
            continue

        payload["status"] = "RECORDED"
        payload["matched"] = False
        inserted = await asyncio.to_thread(
            lambda p=payload: db().table("jobs").insert(p).execute()
        )
        job = inserted.data[0]
        created += 1
        await asyncio.to_thread(
            lambda j=job: db()
            .table("job_events")
            .insert({"job_id": j["id"], "event": "RECORDED", "metadata": {"source_id": source["id"]}})
            .execute()
        )

        if job_matches(job, source.get("rules") or {}):
            queued_count = await asyncio.to_thread(
                lambda: db().table("jobs").select("id", count="exact").eq("status", "QUEUED").execute()
            )
            count = queued_count.count if queued_count.count is not None else 0
            if count < max_queue:
                job = (
                    await asyncio.to_thread(
                        lambda j=job: db()
                        .table("jobs")
                        .update({"status": "QUEUED", "matched": True})
                        .eq("id", j["id"])
                        .execute()
                    )
                ).data[0]
                queued += 1
                await notify_new_job(job)
                await asyncio.to_thread(
                    lambda j=job: db()
                    .table("job_events")
                    .insert({"job_id": j["id"], "event": "QUEUED"})
                    .execute()
                )
            else:
                await asyncio.to_thread(
                    lambda j=job: db().table("jobs").update({"matched": True}).eq("id", j["id"]).execute()
                )

    await asyncio.to_thread(
        lambda: db()
        .table("scanner_sources")
        .update(
            {
                "last_scanned_at": _now().isoformat(),
                "last_error": None,
                "last_job_count": len(drafts),
            }
        )
        .eq("id", source["id"])
        .execute()
    )
    await hub.broadcast_dashboard({"event": "scan_complete", "source_id": source["id"], "found": len(drafts), "new": created})
    if queued:
        await maybe_dispatch()
    return {"found": len(drafts), "new": created, "queued": queued}


def start_scheduler():
    global _scheduler
    if _scheduler:
        return _scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(tick, "interval", seconds=5, id="scanner-tick", max_instances=1, coalesce=True)
    _scheduler.start()
    return _scheduler


def infer_platform(url: str) -> str:
    platform = detect_platform(url)
    if not platform:
        raise ValueError("URL host is not CrowdWorks, Lancers, or Coconala")
    return platform
