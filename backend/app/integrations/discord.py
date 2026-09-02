from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

import httpx

from app.config import settings
from app.platforms.categories import crowdworks_category

log = logging.getLogger("jobscanner.discord")

PLATFORM_STYLE = {
    "crowdworks": {
        "label": "Crowdworks",
        "footer": "CrowdWorks New Job Notification",
        "color": 0xE53935,
        "dot": "🔴",
    },
    "lancers": {
        "label": "Lancers",
        "footer": "Lancers New Job Notification",
        "color": 0x1E88E5,
        "dot": "🔵",
    },
    "coconala": {
        "label": "Coconala",
        "footer": "Coconala New Job Notification",
        "color": 0x00C853,
        "dot": "🟢",
    },
}


def _style(platform: str) -> dict:
    return PLATFORM_STYLE.get((platform or "").lower(), {
        "label": (platform or "Job").title(),
        "footer": f"{(platform or 'Job').title()} New Job Notification",
        "color": 0x90A4AE,
        "dot": "⚪",
    })


def _yen(budget: str | None) -> str:
    if not budget:
        return "—"
    nums = re.findall(r"\d{1,3}(?:,\d{3})+|\d+", str(budget))
    if not nums:
        return str(budget)

    def one(raw: str) -> str:
        return f"¥{int(raw.replace(',', '')):,}"

    parts = [one(n) for n in nums]
    if len(parts) >= 2 and parts[0] != parts[1]:
        return f"{parts[0]}〜{parts[1]}"
    return parts[0]


def remaining_label(deadline: str | None) -> str | None:
    if not deadline:
        return None
    raw = str(deadline).strip()
    try:
        if "T" in raw:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(raw[:10] + "T15:00:00+09:00")
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    hours = (dt - datetime.now(timezone.utc)).total_seconds() / 3600
    if hours <= 0:
        return "0h"
    if hours < 48:
        return f"{max(1, int(round(hours)))}h"
    return f"{int(hours / 24)}d"


def _digest(text: str | None) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"\s+", " ", str(text).replace("\r", " ")).strip()
    if len(cleaned) > 400:
        return cleaned[:397] + "..."
    return cleaned


def _kind(job: dict) -> str:
    kind = (job.get("job_kind") or "").strip().lower()
    if kind in {"contest", "competition", "コンペ"}:
        return "contest"
    if kind in {"task", "タスク"}:
        return "task"
    return "discuss"


def build_new_job_payload(job: dict) -> dict:
    platform = (job.get("platform") or "").lower()
    style = _style(platform)
    title = (job.get("title") or "(no title)").strip()
    client = (job.get("client") or "—").strip() or "—"
    url = (job.get("url") or "").strip()
    extra = job.get("extra") if isinstance(job.get("extra"), dict) else {}
    if platform == "crowdworks":
        job_cid = job.get("category_id") or extra.get("category_id") or job.get("category")
        source_url = job.get("source_url")
        parent, _ = crowdworks_category(None, source_url)
        _, tag = crowdworks_category(job_cid, source_url)
        bracket = parent if source_url else crowdworks_category(job_cid, None)[0]
        heading = f"🔔[{style['label']}_{bracket}] {title} ({tag})"
    else:
        tag = extra.get("tag") or job.get("category") or ("work" if platform == "lancers" else "request" if platform == "coconala" else platform)
        tag = str(tag).strip().lower() or platform
        heading = f"🔔[{style['label']}] {title} ({tag})"
    if len(heading) > 256:
        heading = heading[:253] + "..."

    lock = "🔒" if job.get("login_required") or extra.get("login_required") else "🆓"
    bits = [f"Judgment ✅可 🛡️ {lock}"]
    remain = remaining_label(job.get("deadline"))
    if remain:
        bits.append(f"⏱ {remain}")
    bits.append(f"💰 {_yen(job.get('budget'))}")
    judgment = " · ".join(bits)

    description = extra.get("description") or job.get("description")
    lines = [
        f"{style['dot']} {_kind(job)} · {client}",
        "",
        url,
        "",
        judgment,
    ]
    digest = _digest(description)
    if digest:
        lines.extend(["", digest])
    body = "\n".join(lines).strip()

    embed = {
        "title": heading,
        "description": body,
        "color": style["color"],
        "footer": {"text": style["footer"]},
    }
    if url:
        embed["url"] = url
    return {"embeds": [embed]}


async def notify_new_job(job: dict) -> None:
    if not settings.discord_webhook_url:
        return
    payload = build_new_job_payload(job)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client_http:
            res = await client_http.post(settings.discord_webhook_url, json=payload)
            if res.status_code >= 400:
                log.warning("discord notify %s %s", res.status_code, res.text[:200])
            res.raise_for_status()
    except Exception:
        log.exception("discord notify failed platform=%s url=%s", job.get("platform"), job.get("url"))
