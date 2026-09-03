from fastapi import APIRouter, Depends, Header, HTTPException, Query

from app.auth import require_token
from app.core.scanner import bider_payload, claim_next_job, collect_next_jobs, ingest_jobs
from app.db import JOB_STATUSES
from app.integrations.hub import hub
from app.schemas import JobIngestRequest, JobStatusUpdate
from app.store import (
    active_jobs,
    actor_active_jobs,
    actor_skipped_jobs,
    add_event,
    count_jobs,
    get_job,
    get_source,
    list_jobs,
    queued_for_actor,
    queued_jobs,
    update_job,
    upsert_claim,
)

router = APIRouter(prefix="/api/jobs", dependencies=[Depends(require_token)])


def _actor(
    x_bider_actor: str | None = Header(default=None, alias="X-Bider-Actor"),
    actor: str | None = Query(default=None),
) -> str:
    return ((x_bider_actor or actor or "").strip())[:80]


@router.get("")
def jobs(
    status: str | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    new_only: bool = Query(default=True),
):
    rows = list_jobs(status=status, limit=limit, offset=offset, new_only=new_only)
    total = count_jobs(status=status, new_only=new_only)
    return {"jobs": rows, "total": total}


@router.get("/pending")
def pending(actor: str = Depends(_actor)):
    return queued_for_actor(actor, 50) if actor else queued_jobs(50)


@router.get("/bider")
def bider_snapshot(actor: str = Depends(_actor)):
    current_rows = actor_active_jobs(actor, 10) if actor else active_jobs(10)
    queued = queued_for_actor(actor, 50) if actor else queued_jobs(50)
    skipped = actor_skipped_jobs(actor, 20) if actor else []
    return {
        "current": current_rows[0] if current_rows else None,
        "active": current_rows,
        "queued": queued,
        "skipped": skipped,
        "actor": actor or None,
    }


@router.get("/next")
def next_job(force: bool = Query(default=False), actor: str = Depends(_actor)):
    job = claim_next_job(force=force, actor=actor)
    if not job:
        return {"job": None}
    return {"job": bider_payload(job)}


@router.get("/next-batch")
def next_batch(
    count: int = Query(default=1, ge=1, le=10),
    limit: int | None = Query(default=None, ge=1, le=10),
    force: bool = Query(default=False),
    actor: str = Depends(_actor),
):
    n = int(limit or count)
    return {"jobs": collect_next_jobs(n, force=force, actor=actor)}


@router.post("/ingest")
async def ingest(body: JobIngestRequest, actor: str = Depends(_actor)):
    source = None
    if body.source_id:
        source = get_source(str(body.source_id))
        if not source:
            raise HTTPException(404, "Source not found")
    who = actor or (body.actor or "")
    return await ingest_jobs(body.jobs, source=source, actor=who)


@router.get("/{job_id}")
def job(job_id: str):
    row = get_job(job_id)
    if not row:
        raise HTTPException(404, "Job not found")
    return row


@router.post("/{job_id}/status")
async def set_status(job_id: str, body: JobStatusUpdate, actor: str = Depends(_actor)):
    if body.status not in JOB_STATUSES:
        raise HTTPException(400, "Invalid status")
    row = get_job(job_id)
    if not row:
        raise HTTPException(404, "Job not found")
    who = actor or str((body.metadata or {}).get("actor") or "")
    job = update_job(job_id, {"status": body.status})
    meta = dict(body.metadata or {})
    if who:
        meta["actor"] = who
        upsert_claim(job_id, who, body.status, job.get("url"))
    add_event(job_id, body.status, meta)
    await hub.broadcast({"event": "JOB_STATUS", "job": bider_payload(job)})
    return job
