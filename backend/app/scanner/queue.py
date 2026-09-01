from typing import Any

from app.db import db
from app.realtime import hub


def settings_row() -> dict[str, Any]:
    res = db().table("bider_settings").select("*").eq("id", 1).limit(1).execute()
    return res.data[0] if res.data else {}


def queued_jobs(limit: int = 50) -> list[dict[str, Any]]:
    res = (
        db()
        .table("jobs")
        .select("*")
        .eq("status", "QUEUED")
        .order("detected_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def active_jobs() -> list[dict[str, Any]]:
    res = (
        db()
        .table("jobs")
        .select("*")
        .in_("status", ["SENT_TO_BIDER", "PROCESSING", "PROPOSAL_PAGE_READY", "WAITING_FOR_USER"])
        .order("updated_at")
        .execute()
    )
    return res.data or []


def pending_for_bider() -> list[dict[str, Any]]:
    settings = settings_row()
    max_active = int(settings.get("max_active_jobs") or 1)
    current = active_jobs()
    if len(current) >= max_active:
        return current[:max_active]
    need = max_active - len(current)
    return current + queued_jobs(need)


async def maybe_dispatch() -> None:
    settings = settings_row()
    if not settings.get("enabled"):
        return
    if settings.get("mode") == "paused":
        return
    max_active = int(settings.get("max_active_jobs") or 1)
    if len(active_jobs()) >= max_active:
        return
    queued = queued_jobs(1)
    if not queued:
        return
    job = queued[0]
    if settings.get("mode") == "auto":
        db().table("jobs").update({"status": "SENT_TO_BIDER"}).eq("id", job["id"]).execute()
        job["status"] = "SENT_TO_BIDER"
        await hub.broadcast_bider({"event": "NEW_JOB", "job": job})
    else:
        await hub.broadcast_bider({"event": "JOB_AVAILABLE", "job": job})
    await hub.broadcast_dashboard({"event": "queue_changed"})
