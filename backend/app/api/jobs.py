from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_token
from app.core.scanner import bider_payload, claim_next_job
from app.db import JOB_STATUSES
from app.integrations.hub import hub
from app.schemas import JobStatusUpdate
from app.store import add_event, get_job, list_jobs, queued_jobs, update_job

router = APIRouter(prefix="/api/jobs", dependencies=[Depends(require_token)])


@router.get("")
def jobs(status: str | None = None, limit: int = Query(default=100, le=500)):
    return list_jobs(status=status, limit=limit)


@router.get("/pending")
def pending():
    return queued_jobs(50)


@router.get("/next")
def next_job():
    job = claim_next_job()
    if not job:
        return {"job": None}
    return {"job": bider_payload(job)}


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
