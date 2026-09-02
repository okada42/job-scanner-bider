import logging
from datetime import datetime, timezone

from app.core.fetch import fetch_html
from app.core.rules import client_is_excluded, job_matches
from app.integrations.discord import notify_new_job
from app.integrations.hub import hub
from app.platforms.registry import ADAPTERS
from app.store import (
    add_event,
    find_job,
    get_bider_settings,
    get_control,
    get_source,
    insert_job,
    queued_jobs,
    update_source,
)

log = logging.getLogger("jobscanner.scan")


def _field(item, name, default=None):
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def diagnose_listing_html(html: str) -> str:
    body = html or ""
    head = body[:12000]
    low = head.lower()
    bits = [f"html_bytes={len(body)}"]
    bits.append("vue-container=yes" if "vue-container" in body else "vue-container=no")
    bits.append("job_offers=yes" if "job_offers" in body else "job_offers=no")
    if any(s in low for s in ("ログイン", "login", "sign in", "会員登録")):
        bits.append("login_markers")
    if any(s in body for s in ("Human Verification", "cf-challenge", "Just a moment", "captcha", "Access Denied")):
        bits.append("bot_check")
    return " ".join(bits)


def bider_payload(job: dict) -> dict:
    return {
        "id": job["id"],
        "platform": job["platform"],
        "url": job["url"],
        "title": job.get("title"),
        "budget": job.get("budget"),
        "client": job.get("client"),
        "deadline": job.get("deadline"),
        "status": job.get("status"),
    }


def _item_dict(item) -> dict:
    if isinstance(item, dict):
        return item
    if hasattr(item, "model_dump"):
        return item.model_dump()
    keys = (
        "platform",
        "external_job_id",
        "url",
        "title",
        "client",
        "budget",
        "deadline",
        "application_count",
        "category",
        "source_id",
        "extra",
        "description",
        "job_kind",
        "login_required",
        "category_id",
    )
    return {k: getattr(item, k, None) for k in keys}


def is_first_scan(source: dict | None) -> bool:
    return bool(source) and not source.get("last_scanned_at")


async def ingest_jobs(
    items: list,
    *,
    source: dict | None = None,
    baseline: bool | None = None,
    parse_note: str | None = None,
) -> dict:
    """Crawl ingest: remember every job id, alert only on listings never stored before.

    First successful parse of a source is a baseline: jobs already on the page are
    stored as seen and ignored (no Discord, no bider queue). Later crawls treat a
    job as new only if (platform, external_job_id) or URL is not already in the DB.
    """
    created = 0
    queued = 0
    baselined = 0
    skipped_seen = 0
    skipped_bad_client = 0
    first_scan = is_first_scan(source) if baseline is None else baseline
    settings = get_bider_settings()
    excluded_clients = (get_control() or {}).get("excluded_clients") or []
    max_queue = int(settings.get("max_queue_size") or 100)
    default_source_id = source["id"] if source else None
    default_rules = (source or {}).get("rules") or {}
    source_cache: dict[str, dict | None] = {}
    if source:
        source_cache[str(source["id"])] = source
    touched_ids: set[str] = set()

    for raw in items:
        item = _item_dict(raw)
        platform = item.get("platform")
        external_id = item.get("external_job_id")
        url = item.get("url")
        if not platform or not external_id or not url:
            continue
        sid = item.get("source_id") or default_source_id
        rules = default_rules
        if sid:
            key = str(sid)
            touched_ids.add(key)
            if key not in source_cache:
                source_cache[key] = get_source(key)
            extra = source_cache.get(key)
            if extra is not None:
                rules = extra.get("rules") or {}
        if find_job(platform, str(external_id), url):
            skipped_seen += 1
            continue
        row = {
            "platform": platform,
            "external_job_id": str(external_id),
            "url": url,
            "title": item.get("title"),
            "client": item.get("client"),
            "budget": item.get("budget"),
            "deadline": item.get("deadline"),
            "application_count": item.get("application_count"),
            "category": item.get("category"),
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "status": "RECORDED",
            "matched": False,
        }
        if sid:
            row["source_id"] = str(sid)

        if first_scan:
            try:
                job = insert_job(row)
            except Exception:
                log.exception("insert_job failed (baseline) platform=%s id=%s", platform, external_id)
                continue
            created += 1
            baselined += 1
            add_event(job["id"], "BASELINE", {"reason": "already_listed_on_first_crawl"})
            continue

        if client_is_excluded(row.get("client"), excluded_clients):
            try:
                job = insert_job(row)
            except Exception:
                log.exception("insert_job failed (bad_client) platform=%s id=%s", platform, external_id)
                continue
            created += 1
            skipped_bad_client += 1
            add_event(job["id"], "SKIPPED", {"reason": "bad_client", "client": row.get("client")})
            continue

        matched, reason = job_matches(row, rules)
        row["matched"] = matched
        if matched and len(queued_jobs(max_queue)) < max_queue:
            row["status"] = "QUEUED"
        try:
            job = insert_job(row)
        except Exception:
            log.exception("insert_job failed platform=%s id=%s", platform, external_id)
            continue
        created += 1
        add_event(job["id"], "RECORDED", {"reason": reason, "matched": matched})
        if job["status"] == "QUEUED":
            queued += 1
            add_event(job["id"], "QUEUED", {"reason": reason})
            extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}
            await notify_new_job(
                {
                    **job,
                    "description": item.get("description") or extra.get("description"),
                    "job_kind": item.get("job_kind") or extra.get("job_kind"),
                    "login_required": extra.get("login_required", item.get("login_required")),
                    "category_id": extra.get("category_id") or item.get("category_id") or item.get("category"),
                    "extra": extra,
                    "source_url": (source or {}).get("url"),
                }
            )
            await hub.broadcast({"event": "NEW_JOB", "job": bider_payload(job)})

    stamp = {
        "last_error": None,
    }
    if items:
        stamp["last_job_count"] = len(items)
        stamp["last_scanned_at"] = datetime.now(timezone.utc).isoformat()
    else:
        detail = parse_note or "parser returned no listings"
        if first_scan:
            stamp["last_error"] = (
                f"First crawl parsed 0 jobs ({detail}). "
                "Baseline not complete; existing listings will not be treated as new yet."
            )[:500]
            stamp["last_job_count"] = 0
        else:
            stamp["last_error"] = f"Parsed 0 jobs ({detail})."[:500]
            stamp["last_scanned_at"] = datetime.now(timezone.utc).isoformat()

    if source:
        update_source(source["id"], stamp)
    else:
        for sid in touched_ids:
            if get_source(sid):
                update_source(sid, stamp)

    return {
        "found": len(items),
        "created": created,
        "queued": queued,
        "baselined": baselined,
        "skipped_seen": skipped_seen,
        "skipped_bad_client": skipped_bad_client,
        "baseline": first_scan,
    }


async def scan_source(source: dict) -> dict:
    adapter = ADAPTERS[source["platform"]]
    first = is_first_scan(source)
    log.info(
        "scan start platform=%s source=%s first=%s url=%s",
        source.get("platform"),
        source.get("id"),
        first,
        source.get("url"),
    )
    html = await fetch_html(source["url"])
    note = diagnose_listing_html(html)
    extracted = adapter.parse_listing(html, source["url"])
    log.info(
        "scan parsed platform=%s source=%s found=%s %s",
        source.get("platform"),
        source.get("id"),
        len(extracted),
        note,
    )
    for item in extracted:
        log.info(
            "found platform=%s id=%s title=%s client=%s budget=%s url=%s",
            _field(item, "platform"),
            _field(item, "external_job_id"),
            _field(item, "title"),
            _field(item, "client"),
            _field(item, "budget"),
            _field(item, "url"),
        )
    if not extracted:
        log.warning(
            "scan found nothing platform=%s source=%s url=%s %s",
            source.get("platform"),
            source.get("id"),
            source.get("url"),
            note,
        )
    result = await ingest_jobs(extracted, source=source, parse_note=note)
    sample = [
        {
            "id": _field(item, "external_job_id"),
            "title": _field(item, "title"),
            "client": _field(item, "client"),
            "budget": _field(item, "budget"),
        }
        for item in extracted[:8]
    ]
    result["html_bytes"] = len(html)
    result["sample"] = sample
    result["note"] = note
    log.info("scan ingest platform=%s source=%s %s", source.get("platform"), source.get("id"), result)
    return result


def claim_next_job() -> dict | None:
    from app.store import active_job_count, update_job

    settings = get_bider_settings()
    if not settings.get("enabled") or settings.get("mode") == "paused":
        return None
    if active_job_count() >= int(settings.get("max_active_jobs") or 1):
        return None
    pending = queued_jobs(1)
    if not pending:
        return None
    job = update_job(pending[0]["id"], {"status": "SENT_TO_BIDER"})
    add_event(job["id"], "SENT_TO_BIDER")
    return job
