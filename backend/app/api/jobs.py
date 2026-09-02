from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_token
from app.core.scanner import bider_payload, claim_next_job, ingest_jobs
from app.db import JOB_STATUSES
from app.integrations.hub import hub
from app.schemas import JobIngestRequest, JobStatusUpdate
from app.store import add_event, get_job, get_source, list_jobs, queued_jobs, update_job

router = APIRouter(prefix="/api/jobs", dependencies=[Depends(require_token)])


@router.get("")
def jobs(
    status: str | None = None,
    limit: int = Query(default=100, le=500),
    new_only: bool = Query(default=True),
):
    return list_jobs(status=status, limit=limit, new_only=new_only)


@router.get("/pending")
def pending():
    return queued_jobs(50)


@router.get("/next")
def next_job():
    job = claim_next_job()
    if not job:
        return {"job": None}
    return {"job": bider_payload(job)}


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
