from fastapi import APIRouter, Depends, Header, HTTPException, Query

from app.auth import require_token
from app.core.manual import pin_manual_jobs
from app.core.scanner import bider_payload, claim_next_job, collect_next_jobs, ingest_jobs
from app.db import JOB_STATUSES
from app.integrations.hub import hub
from app.schemas import ClaimBatch, JobIngestRequest, JobStatusUpdate, ManualJobsRequest
from app.store import (
    active_jobs,
    actor_active_jobs,
    actor_skipped_jobs,
    add_event,
    claims_for_jobs,
    count_jobs,
    get_job,
    get_source,
    list_claim_actors,
    list_jobs,
    queued_for_actor,
    queued_jobs,
    touch_actor,
    update_job,
    upsert_claim,
    upsert_queued_claim,
)

router = APIRouter(prefix="/api/jobs", dependencies=[Depends(require_token)])

_SENT_STATES = {
    "SENT_TO_BIDER",
    "PROCESSING",
    "PROPOSAL_PAGE_READY",
    "WAITING_FOR_USER",
    "COMPLETED",
}
_SKIPPED_STATES = {"SKIPPED", "CLOSED", "FAILED"}


def user_state_label(status: str | None) -> str:
    raw = str(status or "").strip().upper()
    if raw in _SKIPPED_STATES:
        return "skipped"
    if raw in _SENT_STATES:
        return "ready"
    return "queued"


def attach_user_states(rows: list[dict]) -> list[dict]:
    ids = [str(job.get("id") or "") for job in rows if job.get("id")]
    today = claims_for_jobs(ids)
    actors = list_claim_actors()
    seen = {name.lower(): name for name in actors}
    for job in rows:
        jid = str(job.get("id") or "")
        claims = today.get(jid, [])
        job["claims"] = claims
        names = list(actors)
        for claim in claims:
            actor = str(claim.get("actor") or "").strip()
            if actor and actor.lower() not in seen and not actor.lower().startswith("ext-"):
                seen[actor.lower()] = actor
                names.append(actor)
        claimed = {str(c.get("actor") or "").strip().lower(): c for c in claims}
        states = []
        for actor in names:
            claim = claimed.get(actor.lower())
            states.append(
                {
                    "actor": actor,
                    "state": user_state_label(claim.get("status") if claim else None),
                    "updated_at": claim.get("updated_at") if claim else None,
                }
            )
        job["user_states"] = states
    return rows


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
    rows = attach_user_states(list_jobs(status=status, limit=limit, offset=offset, new_only=new_only))
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


@router.post("/manual")
async def manual_jobs(body: ManualJobsRequest):
    return await pin_manual_jobs(text=body.text or "", urls=body.urls)


@router.post("/actor")
def register_actor(actor: str = Depends(_actor)):
    who = touch_actor(actor)
    return {"ok": True, "actor": who or None}


@router.post("/claims")
def register_claims(body: ClaimBatch, actor: str = Depends(_actor)):
    who = touch_actor(actor or (body.actor or ""))
    if not who:
        return {"ok": False, "actor": None, "updated": 0}
    n = 0
    for item in (body.claims or [])[:40]:
        jid = str(item.job_id or "").strip()
        if not jid:
            continue
        upsert_queued_claim(jid, who, item.url)
        n += 1
    return {"ok": True, "actor": who, "updated": n}


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
        touch_actor(who)
    add_event(job_id, body.status, meta)
    await hub.broadcast({"event": "JOB_STATUS", "job": bider_payload(job)})
    return job
