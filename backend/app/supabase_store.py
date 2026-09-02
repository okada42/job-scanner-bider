from datetime import datetime, timezone
from typing import Any

from app.db import supabase

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


def list_jobs(status: str | None = None, limit: int = 100) -> list[dict]:
    try:
        q = supabase().table("jobs").select("*").order("detected_at", desc=True).limit(limit)
        if status:
            q = q.eq("status", status)
        return q.execute().data or []
    except Exception:
        return []


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


def insert_job(row: dict) -> dict:
    res = supabase().table("jobs").insert(row).execute()
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
