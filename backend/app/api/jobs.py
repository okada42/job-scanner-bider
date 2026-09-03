from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_token
from app.core.scanner import bider_payload, claim_next_job, ingest_jobs
from app.db import JOB_STATUSES
from app.integrations.hub import hub
from app.schemas import JobIngestRequest, JobStatusUpdate
from app.store import active_jobs, add_event, count_jobs, get_job, get_source, list_jobs, queued_jobs, update_job

router = APIRouter(prefix="/api/jobs", dependencies=[Depends(require_token)])


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
def pending():
    return queued_jobs(50)


@router.get("/bider")
def bider_snapshot():
    current_rows = active_jobs(10)
    return {
        "current": current_rows[0] if current_rows else None,
        "active": current_rows,
        "queued": queued_jobs(8),
    }


@router.get("/next")
def next_job():
    job = claim_next_job()
    if not job:
        return {"job": None}
    return {"job": bider_payload(job)}


@router.get("/next-batch")
def next_batch(count: int = Query(default=1, ge=1, le=10)):
    jobs = []
    for _ in range(count):
        job = claim_next_job()
        if not job:
            break
        jobs.append(bider_payload(job))
    return {"jobs": jobs}


@router.post("/ingest")
async def ingest(body: JobIngestRequest):
    source = None
    if body.source_id:
        source = get_source(str(body.source_id))
        if not source:
            raise HTTPException(404, "Source not found")
    return await ingest_jobs(body.jobs, source=source)


@router.get("/{job_id}")
def job(job_id: str):
    row = get_job(job_id)
    if not row:
        raise HTTPException(404, "Job not found")
    return row


@router.post("/{job_id}/status")
async def set_status(job_id: str, body: JobStatusUpdate):
    if body.status not in JOB_STATUSES:
        raise HTTPException(400, "Invalid status")
    row = get_job(job_id)
    if not row:
        raise HTTPException(404, "Job not found")
    job = update_job(job_id, {"status": body.status})
    add_event(job_id, body.status, body.metadata)
    await hub.broadcast({"event": "JOB_STATUS", "job": bider_payload(job)})
    return job
