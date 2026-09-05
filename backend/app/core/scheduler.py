import asyncio
import logging
from datetime import datetime, timezone

from app.config import settings
from app.core.clock import local_day_start_iso, scanner_zone
from app.core.scanner import scan_source
from app.store import expire_stale_bider_jobs, get_control, list_sources, update_source

log = logging.getLogger("jobscanner.scheduler")

_task: asyncio.Task | None = None
_running = False
_rolled_day: str | None = None
_last_rollover: dict = {"day": None, "expired": 0, "at": None, "error": None}


def scheduler_alive() -> bool:
    return _running


def last_rollover() -> dict:
    return dict(_last_rollover)


def current_day() -> str:
    return datetime.now(scanner_zone()).strftime("%Y-%m-%d")


def rollover_if_new_day(force: bool = False) -> int | None:
    """Once per scanner-local day (and at startup) expire Bider jobs detected before today.

    Returns the number of expired jobs, or None when the rollover already ran today.
    """
    global _rolled_day
    day = current_day()
    if not force and _rolled_day == day:
        return None
    _rolled_day = day
    try:
        expired = expire_stale_bider_jobs(local_day_start_iso())
    except Exception as exc:
        _rolled_day = None
        _last_rollover.update({"day": day, "at": datetime.now(timezone.utc).isoformat(), "error": str(exc)[:300]})
        log.exception("daily rollover failed day=%s", day)
        return 0
    _last_rollover.update(
        {"day": day, "expired": len(expired), "at": datetime.now(timezone.utc).isoformat(), "error": None}
    )
    log.info("daily rollover day=%s expired=%s", day, len(expired))
    return len(expired)


async def _loop() -> None:
    global _running
    _running = True
    try:
        while _running:
            try:
                await asyncio.to_thread(rollover_if_new_day)
                control = await asyncio.to_thread(get_control)
                html_scan = (settings.scan_mode or "html").lower() != "extension"
                if html_scan and control.get("enabled"):
                    platforms = control.get("platforms") or {}
                    now = datetime.now(timezone.utc)
                    for source in await asyncio.to_thread(list_sources):
                        if not source.get("enabled"):
                            continue
                        if not platforms.get(source["platform"], True):
                            continue
                        interval = int(source.get("scan_interval") or 60)
                        last = source.get("last_scanned_at") or source.get("updated_at")
                        due = True
                        if last:
                            last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                            due = (now - last_dt).total_seconds() >= interval
                        if not due:
                            continue
                        try:
                            await scan_source(source)
                        except Exception as exc:
                            log.exception(
                                "scan failed platform=%s source=%s url=%s",
                                source.get("platform"),
                                source.get("id"),
                                source.get("url"),
                            )
                            await asyncio.to_thread(
                                update_source, source["id"], {"last_error": str(exc)[:500]}
                            )
            except Exception:
                log.exception("scheduler loop error")
            await asyncio.sleep(1)
    finally:
        _running = False


def start_scheduler() -> None:
    global _task
    if _task and not _task.done():
        return
    _task = asyncio.create_task(_loop())


def stop_scheduler_loop() -> None:
    global _running, _task
    _running = False
    if _task:
        _task.cancel()
        _task = None
