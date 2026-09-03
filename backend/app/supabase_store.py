import threading
import time
from datetime import datetime, timezone
from typing import Any

from app.db import supabase

_AGE_STATUSES = ("PROCESSING", "COMPLETED", "SENT_TO_BIDER", "WAITING_FOR_USER")
_ACTIVE_STATUSES = ("SENT_TO_BIDER", "PROCESSING", "PROPOSAL_PAGE_READY", "WAITING_FOR_USER")
_CLAIM_BLOCK = (
    "SENT_TO_BIDER",
    "PROCESSING",
    "PROPOSAL_PAGE_READY",
    "WAITING_FOR_USER",
    "COMPLETED",
    "SKIPPED",
)
_BIDER_POOL = (
    "QUEUED",
    "SENT_TO_BIDER",
    "PROCESSING",
    "PROPOSAL_PAGE_READY",
    "WAITING_FOR_USER",
    "SKIPPED",
    "COMPLETED",
)
_BASELINE_TTL_SEC = 45.0
_baseline_lock = threading.Lock()
_baseline_cache: tuple[float, set[str]] | None = None

DEFAULT_CONTROL = {
    "id": 1,
    "enabled": False,
    "platforms": {"crowdworks": True, "lancers": True, "coconala": True},
    "record_all": True,
    "excluded_clients": [],
}

DEFAULT_BIDER = {
    "id": 1,
    "enabled": True,
    "mode": "semi-auto",
    "max_active_jobs": 1,
    "max_queue_size": 100,
    "delay_between_jobs": 5,
    "auto_next": False,
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_event(job_id: str, event: str, metadata: dict[str, Any] | None = None) -> None:
    supabase().table("job_events").insert(
        {"job_id": job_id, "event": event, "metadata": metadata or {}}
    ).execute()
    if event == "BASELINE":
        _invalidate_baseline_ids()


def _invalidate_baseline_ids() -> None:
    global _baseline_cache
    with _baseline_lock:
        _baseline_cache = None


def _baseline_job_ids(sb) -> set[str]:
    global _baseline_cache
    now = time.monotonic()
    with _baseline_lock:
        if _baseline_cache and (now - _baseline_cache[0]) < _BASELINE_TTL_SEC:
            return _baseline_cache[1]
    ids: set[str] = set()
    start = 0
    page = 1000
    while True:
        ev = (
            sb.table("job_events")
            .select("job_id")
            .eq("event", "BASELINE")
            .range(start, start + page - 1)
            .execute()
        )
        rows = ev.data or []
        ids.update(str(row["job_id"]) for row in rows if row.get("job_id"))
        if len(rows) < page:
            break
        start += page
    with _baseline_lock:
        _baseline_cache = (time.monotonic(), ids)
    return ids


def _jobs_query(sb, status: str | None, count: bool = False):
    q = sb.table("jobs").select("id", count="exact") if count else sb.table("jobs").select("*")
    if status:
        q = q.eq("status", status)
    return q


def get_control() -> dict:
    try:
        res = supabase().table("scanner_control").select("*").eq("id", 1).limit(1).execute()
        rows = res.data or []
        if rows:
            row = dict(rows[0])
            row.setdefault("excluded_clients", [])
            if row["excluded_clients"] is None:
                row["excluded_clients"] = []
            return row
    except Exception:
        pass
    return dict(DEFAULT_CONTROL)


def update_control(patch: dict) -> dict:
    patch = {**patch, "updated_at": now_iso()}
    res = supabase().table("scanner_control").update(patch).eq("id", 1).execute()
    rows = res.data or []
    return rows[0] if rows else {**get_control(), **patch}


def get_bider_settings() -> dict:
    try:
        res = supabase().table("bider_settings").select("*").eq("id", 1).limit(1).execute()
        rows = res.data or []
        if rows:
            return rows[0]
    except Exception:
        pass
    return dict(DEFAULT_BIDER)


def update_bider_settings(patch: dict) -> dict:
    patch = {**patch, "updated_at": now_iso()}
    res = supabase().table("bider_settings").update(patch).eq("id", 1).execute()
    rows = res.data or []
    return rows[0] if rows else {**get_bider_settings(), **patch}


def list_sources() -> list[dict]:
    try:
        res = supabase().table("scanner_sources").select("*").order("created_at").execute()
        return res.data or []
    except Exception:
        return []


def job_counts_by_source() -> dict[str, int]:
    counts: dict[str, int] = {}
    try:
        sb = supabase()
        for source in list_sources():
            sid = str(source.get("id") or "")
            if not sid:
                continue
            res = sb.table("jobs").select("id", count="exact").eq("source_id", sid).limit(1).execute()
            counts[sid] = int(res.count or 0)
    except Exception:
        return counts
    return counts


def job_counts_since_by_source(since_iso: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    try:
        sb = supabase()
        for source in list_sources():
            sid = str(source.get("id") or "")
            if not sid:
                continue
            ids: list[str] = []
            start = 0
            page = 1000
            while True:
                jobs_res = (
                    sb.table("jobs")
                    .select("id")
                    .eq("source_id", sid)
                    .gte("created_at", since_iso)
                    .range(start, start + page - 1)
                    .execute()
                )
                rows = jobs_res.data or []
                ids.extend(str(row["id"]) for row in rows if row.get("id"))
                if len(rows) < page:
                    break
                start += page
            if not ids:
                counts[sid] = 0
                continue
            baseline_ids: set[str] = set()
            chunk = 100
            for i in range(0, len(ids), chunk):
                part = ids[i : i + chunk]
                ev = (
                    sb.table("job_events")
                    .select("job_id")
                    .eq("event", "BASELINE")
                    .in_("job_id", part)
                    .execute()
                )
                baseline_ids.update(str(row["job_id"]) for row in (ev.data or []) if row.get("job_id"))
            counts[sid] = len(ids) - len(baseline_ids)
    except Exception:
        return counts
    return counts


def get_source(source_id: str) -> dict | None:
    try:
        res = supabase().table("scanner_sources").select("*").eq("id", source_id).limit(1).execute()
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def insert_source(row: dict) -> dict:
    res = supabase().table("scanner_sources").insert(row).execute()
    return res.data[0]


def update_source(source_id: str, patch: dict) -> dict:
    patch = {**patch, "updated_at": now_iso()}
    try:
        res = supabase().table("scanner_sources").update(patch).eq("id", source_id).execute()
        return res.data[0]
    except Exception:
        patch.pop("last_listing_total", None)
        res = supabase().table("scanner_sources").update(patch).eq("id", source_id).execute()
        return res.data[0]


def delete_source(source_id: str) -> None:
    supabase().table("scanner_sources").delete().eq("id", source_id).execute()


def count_jobs(status: str | None = None, new_only: bool = False) -> int:
    try:
        sb = supabase()
        res = _jobs_query(sb, status, count=True).limit(1).execute()
        total = int(res.count or 0)
        if not new_only:
            return total
        baseline = set(_baseline_job_ids(sb))
        if not status:
            return max(0, total - len(baseline))
        counted = 0
        start = 0
        page = 1000
        while True:
            rows = (
                sb.table("jobs")
                .select("id")
                .eq("status", status)
                .range(start, start + page - 1)
                .execute()
                .data
                or []
            )
            counted += sum(1 for row in rows if str(row.get("id") or "") not in baseline)
            if len(rows) < page:
                break
            start += page
        return counted
    except Exception:
        return 0


def list_jobs(status: str | None = None, limit: int = 100, new_only: bool = False, offset: int = 0) -> list[dict]:
    try:
        sb = supabase()
        baseline = _baseline_job_ids(sb) if new_only else set()
        off = max(0, int(offset))
        lim = max(1, int(limit))
        skip = off
        collected: list[dict] = []
        start = 0
        page = 100
        while len(collected) < lim:
            q = _jobs_query(sb, status).order("detected_at", desc=True)
            batch = q.range(start, start + page - 1).execute().data or []
            if not batch:
                break
            for job in batch:
                if baseline and str(job.get("id") or "") in baseline:
                    continue
                if skip > 0:
                    skip -= 1
                    continue
                collected.append(job)
                if len(collected) >= lim:
                    break
            if len(batch) < page:
                break
            start += page
        return _attach_status_at(sb, collected)
    except Exception:
        return []


def active_jobs(limit: int = 10) -> list[dict]:
    try:
        sb = supabase()
        jobs = (
            sb.table("jobs")
            .select("*")
            .in_("status", list(_ACTIVE_STATUSES))
            .order("updated_at", desc=True)
            .limit(int(limit))
            .execute()
            .data
            or []
        )
        return _attach_status_at(sb, jobs)
    except Exception:
        return []


def _attach_status_at(sb, jobs: list[dict]) -> list[dict]:
    timed = [j for j in jobs if str(j.get("status") or "") in _AGE_STATUSES and j.get("id")]
    if not timed:
        for job in jobs:
            job["status_at"] = job.get("updated_at")
        return jobs
    ids = [str(j["id"]) for j in timed]
    latest: dict[tuple[str, str], str] = {}
    start = 0
    page = 1000
    while True:
        ev = (
            sb.table("job_events")
            .select("job_id,event,timestamp")
            .in_("job_id", ids)
            .in_("event", list(_AGE_STATUSES))
            .range(start, start + page - 1)
            .execute()
        )
        rows = ev.data or []
        for row in rows:
            key = (str(row.get("job_id")), str(row.get("event")))
            ts = row.get("timestamp")
            if not ts:
                continue
            if key not in latest or str(ts) > str(latest[key]):
                latest[key] = ts
        if len(rows) < page:
            break
        start += page
    for job in jobs:
        job["status_at"] = latest.get((str(job.get("id")), str(job.get("status")))) or job.get("updated_at")
    return jobs


def get_job(job_id: str) -> dict | None:
    try:
        res = supabase().table("jobs").select("*").eq("id", job_id).limit(1).execute()
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def find_job(platform: str, external_job_id: str | None, url: str) -> dict | None:
    try:
        sb = supabase()
        if external_job_id:
            res = (
                sb.table("jobs")
                .select("*")
                .eq("platform", platform)
                .eq("external_job_id", external_job_id)
                .limit(1)
                .execute()
            )
            if res.data:
                return res.data[0]
        res = sb.table("jobs").select("*").eq("platform", platform).eq("url", url).limit(1).execute()
        return (res.data or [None])[0]
    except Exception:
        return None


_JOB_INSERT_KEYS = {
    "id",
    "platform",
    "external_job_id",
    "url",
    "title",
    "client",
    "budget",
    "deadline",
    "application_count",
    "category",
    "detected_at",
    "status",
    "priority",
    "matched",
    "source_id",
    "created_at",
    "updated_at",
}


def insert_job(row: dict) -> dict:
    payload = {k: v for k, v in row.items() if k in _JOB_INSERT_KEYS and v is not None}
    res = supabase().table("jobs").insert(payload).execute()
    return res.data[0]


def update_job(job_id: str, patch: dict) -> dict:
    patch = {**patch, "updated_at": now_iso()}
    res = supabase().table("jobs").update(patch).eq("id", job_id).execute()
    return res.data[0]


def queued_jobs(limit: int = 50) -> list[dict]:
    try:
        return (
            supabase()
            .table("jobs")
            .select("*")
            .eq("status", "QUEUED")
            .order("detected_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception:
        return []


def jobs_failed_discord(limit: int = 50) -> list[dict]:
    """Jobs whose Discord alert failed and has not been sent yet (retry queue)."""
    try:
        sb = supabase()
        failed = sb.table("job_events").select("job_id").eq("event", "DISCORD_FAILED").limit(200).execute()
        sent = sb.table("job_events").select("job_id").eq("event", "DISCORD_SENT").limit(1000).execute()
        sent_ids = {str(row.get("job_id")) for row in (sent.data or []) if row.get("job_id")}
        ids: list[str] = []
        for row in failed.data or []:
            jid = str(row.get("job_id") or "")
            if not jid or jid in sent_ids or jid in ids:
                continue
            ids.append(jid)
            if len(ids) >= int(limit):
                break
        out: list[dict] = []
        for jid in ids:
            job = get_job(jid)
            if job:
                out.append(job)
        return out
    except Exception:
        return []


def active_job_count() -> int:
    try:
        res = (
            supabase()
            .table("jobs")
            .select("id", count="exact")
            .in_("status", ["SENT_TO_BIDER", "PROCESSING", "PROPOSAL_PAGE_READY", "WAITING_FOR_USER"])
            .execute()
        )
        return res.count or 0
    except Exception:
        return 0


def claim_day() -> str:
    from app.core.clock import scanner_zone

    return datetime.now(scanner_zone()).strftime("%Y-%m-%d")


def _claim_is_today(row: dict) -> bool:
    from app.core.clock import local_day_start, parse_when

    if not row:
        return False
    day = claim_day()
    raw_day = str(row.get("day") or "")[:10]
    if raw_day:
        return raw_day == day
    dt = parse_when(row.get("updated_at"))
    return bool(dt and dt >= local_day_start())


def upsert_claim(job_id: str, actor: str, status: str, url: str | None = None) -> None:
    if not job_id or not actor:
        return
    payload = {
        "job_id": job_id,
        "actor": actor,
        "status": status,
        "url": url,
        "updated_at": now_iso(),
        "day": claim_day(),
    }
    try:
        supabase().table("bider_claims").upsert(payload).execute()
    except Exception:
        payload.pop("day", None)
        try:
            supabase().table("bider_claims").upsert(payload).execute()
        except Exception:
            return


def actor_active_count(actor: str) -> int:
    if not actor:
        return active_job_count()
    try:
        rows = (
            supabase()
            .table("bider_claims")
            .select("job_id,status,day,updated_at")
            .eq("actor", actor)
            .in_("status", list(_ACTIVE_STATUSES))
            .execute()
            .data
            or []
        )
        return sum(1 for row in rows if _claim_is_today(row))
    except Exception:
        return active_job_count()


def actor_active_jobs(actor: str, limit: int = 10) -> list[dict]:
    if not actor:
        return active_jobs(limit)
    try:
        claims = (
            supabase()
            .table("bider_claims")
            .select("job_id,status,url,day,updated_at")
            .eq("actor", actor)
            .in_("status", list(_ACTIVE_STATUSES))
            .order("updated_at", desc=True)
            .limit(40)
            .execute()
            .data
            or []
        )
        out = []
        for claim in claims:
            if not _claim_is_today(claim):
                continue
            job = get_job(str(claim.get("job_id") or ""))
            if job:
                job["claim_status"] = claim.get("status")
                out.append(job)
            if len(out) >= int(limit):
                break
        return out
    except Exception:
        return active_jobs(limit)


def queued_for_actor(actor: str, limit: int = 50) -> list[dict]:
    if not actor:
        return queued_jobs(limit)
    try:
        sb = supabase()
        claims = sb.table("bider_claims").select("job_id,status,day,updated_at").eq("actor", actor).execute().data or []
        blocked = {
            str(c.get("job_id"))
            for c in claims
            if c.get("status") in _CLAIM_BLOCK and _claim_is_today(c)
        }
        baseline = _baseline_job_ids(sb)
        jobs = (
            sb.table("jobs")
            .select("*")
            .in_("status", list(_BIDER_POOL))
            .order("detected_at", desc=True)
            .limit(200)
            .execute()
            .data
            or []
        )
        out = []
        for job in jobs:
            jid = str(job.get("id") or "")
            if not jid or jid in blocked or jid in baseline:
                continue
            out.append(job)
            if len(out) >= int(limit):
                break
        return out
    except Exception:
        return queued_jobs(limit)


def actor_skipped_jobs(actor: str, limit: int = 20) -> list[dict]:
    if not actor:
        return list_jobs(status="SKIPPED", limit=limit, new_only=True)
    try:
        claims = (
            supabase()
            .table("bider_claims")
            .select("job_id,status,day,updated_at")
            .eq("actor", actor)
            .eq("status", "SKIPPED")
            .order("updated_at", desc=True)
            .limit(50)
            .execute()
            .data
            or []
        )
        out = []
        for claim in claims:
            if not _claim_is_today(claim):
                continue
            job = get_job(str(claim.get("job_id") or ""))
            if job:
                job["claim_status"] = "SKIPPED"
                out.append(job)
            if len(out) >= int(limit):
                break
        return out
    except Exception:
        return list_jobs(status="SKIPPED", limit=limit, new_only=True)
