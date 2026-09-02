import asyncio
from datetime import datetime, timezone

from app.config import settings
from app.core.scanner import scan_source
from app.store import get_control, list_sources, update_source

_task: asyncio.Task | None = None
_running = False


def scheduler_alive() -> bool:
    return _running


async def _loop() -> None:
    global _running
    _running = True
    try:
        while _running:
            try:
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
                        interval = int(source.get("scan_interval") or 20)
                        last = source.get("last_scanned_at")
                        due = True
                        if last:
                            last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                            due = (now - last_dt).total_seconds() >= interval
                        if not due:
                            continue
                        try:
                            await scan_source(source)
                        except Exception as exc:
                            await asyncio.to_thread(
                                update_source, source["id"], {"last_error": str(exc)[:500]}
                            )
            except Exception:
                pass
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
