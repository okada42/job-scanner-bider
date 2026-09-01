from app.integrations.hub import hub
from app.store import (
    active_job_count,
    add_event,
    get_bider_settings,
    queued_jobs,
    update_job,
)


async def maybe_dispatch() -> dict | None:
    settings = get_bider_settings()
    if not settings.get("enabled"):
        return None
    if settings.get("mode") == "paused":
        return None
    if not hub.connected:
        return None
    if active_job_count() >= int(settings.get("max_active_jobs") or 1):
        return None
    pending = queued_jobs(limit=1)
    if not pending:
        return None
    job = pending[0]
    job = update_job(job["id"], {"status": "SENT_TO_BIDER"})
    add_event(job["id"], "SENT_TO_BIDER")
    await hub.broadcast({"event": "NEW_JOB", "job": job})
    return job
