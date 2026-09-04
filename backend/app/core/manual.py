from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from app.core.priority import MANUAL_PRIORITY, is_manual_job
from app.core.scanner import bider_payload
from app.integrations.hub import hub
from app.store import add_event, find_job, insert_job, update_job

_PATTERNS = (
    ("crowdworks", re.compile(r"/public/jobs/(\d+)")),
    ("lancers", re.compile(r"/work/detail/(\d+)")),
    ("coconala", re.compile(r"/requests/(\d+)")),
)

_CANON = {
    "crowdworks": "https://crowdworks.jp/public/jobs/{id}",
    "lancers": "https://www.lancers.jp/work/detail/{id}",
    "coconala": "https://coconala.com/requests/{id}",
}

MAX_MANUAL_URLS = 10


def parse_job_url(raw: str) -> dict | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if "://" not in text:
        text = "https://" + text
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    host = (parsed.netloc or "").lower()
    path = parsed.path or ""
    if "crowdworks.jp" in host:
        platform, pat = _PATTERNS[0]
    elif "lancers.jp" in host:
        platform, pat = _PATTERNS[1]
    elif "coconala.com" in host:
        platform, pat = _PATTERNS[2]
    else:
        return None
    match = pat.search(path)
    if not match:
        return None
    jid = match.group(1)
    return {
        "platform": platform,
        "external_job_id": jid,
        "url": _CANON[platform].format(id=jid),
    }


def parse_job_urls(text: str, urls: list[str] | None = None) -> tuple[list[dict], list[str]]:
    lines: list[str] = []
    for part in (urls or []):
        lines.append(str(part or ""))
    for line in str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        lines.append(line)
    seen: set[tuple[str, str]] = set()
    parsed: list[dict] = []
    skipped: list[str] = []
    for line in lines:
        raw = line.strip()
        if not raw:
            continue
        item = parse_job_url(raw)
        if not item:
            skipped.append(raw[:200])
            continue
        key = (item["platform"], item["external_job_id"])
        if key in seen:
            continue
        seen.add(key)
        parsed.append(item)
        if len(parsed) >= MAX_MANUAL_URLS:
            break
    return parsed, skipped


async def pin_manual_jobs(text: str = "", urls: list[str] | None = None) -> dict:
    parsed, skipped = parse_job_urls(text, urls)
    jobs: list[dict] = []
    created = 0
    bumped = 0
    now = datetime.now(timezone.utc).isoformat()
    total = len(parsed)
    for index, item in enumerate(parsed):
        priority = MANUAL_PRIORITY + (total - index)
        existing = find_job(item["platform"], item["external_job_id"], item["url"])
        if existing:
            patch = {
                "priority": max(int(existing.get("priority") or 0), priority),
                "url": item["url"],
                "matched": True,
            }
            if str(existing.get("status") or "") not in {
                "SENT_TO_BIDER",
                "PROCESSING",
                "PROPOSAL_PAGE_READY",
                "WAITING_FOR_USER",
            }:
                patch["status"] = "QUEUED"
            job = update_job(existing["id"], patch)
            bumped += 1
            add_event(job["id"], "MANUAL", {"url": job.get("url"), "priority": job.get("priority")})
        else:
            job = insert_job(
                {
                    "platform": item["platform"],
                    "external_job_id": item["external_job_id"],
                    "url": item["url"],
                    "title": None,
                    "detected_at": now,
                    "status": "QUEUED",
                    "priority": priority,
                    "matched": True,
                }
            )
            created += 1
            add_event(job["id"], "MANUAL", {"url": job.get("url"), "priority": priority})
            add_event(job["id"], "QUEUED", {"reason": "manual_url"})
        payload = bider_payload(job)
        jobs.append(payload)
        await hub.broadcast({"event": "MANUAL_JOB", "job": payload})
    return {
        "ok": True,
        "jobs": jobs,
        "created": created,
        "bumped": bumped,
        "skipped": skipped,
        "manual": True,
    }


def mark_payload_manual(job: dict) -> dict:
    if is_manual_job(job):
        job = {**job, "manual": True}
    return job
