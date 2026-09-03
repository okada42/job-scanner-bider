from __future__ import annotations

import logging
import os
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
        "color": 0x1E88E5,
        "dot": "🔵",
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
        "color": 0xFDD835,
        "dot": "🟡",
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


def _verification(job: dict, extra: dict) -> str:
    flags = [
        extra.get("verified"),
        extra.get("is_employer_certification"),
        extra.get("identity_verified"),
        job.get("verified"),
        job.get("is_employer_certification"),
    ]
    if any(value is True for value in flags):
        return "Verification ✅認定"
    if any(value is False for value in flags):
        return "Verification ❌未認定"
    return "Verification —"


def is_hourly_job(job: dict, extra: dict | None = None) -> bool:
    extra = extra if isinstance(extra, dict) else {}
    if extra.get("hourly") is True or job.get("hourly") is True:
        return True
    kind = str(extra.get("payment_type") or job.get("payment_type") or "").lower()
    if kind in {"hourly", "時給", "時間単価"}:
        return True
    hay = " ".join(
        str(part)
        for part in (job.get("budget"), job.get("title"), extra.get("tag"))
        if part
    )
    return bool(re.search(r"時給|時間単価|/時|\bhourly\b", hay, re.I))


def _kind(job: dict) -> str:
    kind = (job.get("job_kind") or "").strip().lower()
    if kind in {"contest", "competition", "コンペ"}:
        return "contest"
    if kind in {"task", "タスク"}:
        return "task"
    return "discuss"


def job_post_url(job: dict) -> str:
    """Canonical listing URL that can be copied from Discord as plain text."""
    platform = (job.get("platform") or "").lower()
    jid = str(job.get("external_job_id") or "").strip()
    raw = (job.get("url") or "").strip()
    templates = {
        "crowdworks": "https://crowdworks.jp/public/jobs/{id}",
        "lancers": "https://www.lancers.jp/work/detail/{id}",
        "coconala": "https://coconala.com/requests/{id}",
    }
    if jid and platform in templates:
        return templates[platform].format(id=jid)
    if raw.startswith("https://") or raw.startswith("http://"):
        return raw.split("#")[0].split("?")[0].rstrip("/")
    return raw


def build_new_job_payload(job: dict) -> dict:
    platform = (job.get("platform") or "").lower()
    style = _style(platform)
    title = (job.get("title") or "(no title)").strip()
    client = (job.get("client") or "—").strip() or "—"
    url = job_post_url(job)
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
    if is_hourly_job(job, extra):
        bits.append("Hourly 時給")
    remain = remaining_label(job.get("deadline"))
    if remain:
        bits.append(f"⏱ {remain}")
    money = _yen(job.get("budget"))
    if is_hourly_job(job, extra) and money != "—":
        bits.append(f"💰 時給 {money}")
    else:
        bits.append(f"💰 {money}")
    judgment = " · ".join(bits)

    lines = []
    if url:
        # Fenced block gets Discord's one-click copy control, directly under the title.
        lines.extend([f"```\n{url}\n```", ""])
    lines.extend(
        [
            f"{style['dot']} {_kind(job)} · {client}",
            _verification(job, extra),
            "",
            judgment,
        ]
    )
    body = "\n".join(lines).strip()

    embed = {
        "title": heading,
        "description": body,
        "color": style["color"],
        "footer": {"text": style["footer"]},
    }
    if url:
        embed["url"] = url
    return {
        "content": "@here",
        "allowed_mentions": {"parse": ["everyone"]},
        "embeds": [embed],
    }


async def notify_new_job(job: dict) -> bool:
    """Post a Discord webhook for one job. True if Discord accepted it (or tests skip HTTP)."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    if not settings.discord_webhook_url:
        log.warning("discord webhook unset; cannot notify url=%s", job.get("url"))
        return False
    payload = build_new_job_payload(job)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client_http:
            res = await client_http.post(settings.discord_webhook_url, json=payload)
            if res.status_code >= 400:
                log.warning("discord notify %s %s", res.status_code, res.text[:200])
                return False
            return True
    except Exception:
        log.exception("discord notify failed platform=%s url=%s", job.get("platform"), job.get("url"))
        return False
