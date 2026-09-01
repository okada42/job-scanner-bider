import httpx

from app.config import settings


def _fmt_budget(budget: str | None) -> str:
    if not budget:
        return "—"
    if "¥" in budget or "円" in budget:
        return budget
    return f"¥{budget}"


async def notify_new_job(job: dict) -> None:
    if not settings.discord_webhook_url:
        return
    platform = (job.get("platform") or "").title()
    title = job.get("title") or "(no title)"
    client = job.get("client") or "—"
    budget = _fmt_budget(job.get("budget"))
    deadline = job.get("deadline") or "—"
    url = job.get("url") or ""
    content = (
        f"🚨 **NEW JOB**\n\n"
        f"Platform: {platform}\n\n"
        f"📌 {title}\n"
        f"👤 {client}\n"
        f"💰 {budget}\n"
        f"📅 {deadline}\n\n"
        f"🔗 [Open Job]({url})"
    )
    async with httpx.AsyncClient(timeout=15.0) as client_http:
        await client_http.post(settings.discord_webhook_url, json={"content": content})
