from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.config import settings

DEFAULT_SCANNER_TZ = "Asia/Tokyo"


def scanner_zone() -> ZoneInfo:
    name = (getattr(settings, "scanner_tz", None) or DEFAULT_SCANNER_TZ).strip() or DEFAULT_SCANNER_TZ
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo(DEFAULT_SCANNER_TZ)


def local_day_start(now: datetime | None = None) -> datetime:
    """Return the current scanner-local midnight as an aware UTC datetime."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    local = current.astimezone(scanner_zone())
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc)


def local_day_start_iso(now: datetime | None = None) -> str:
    return local_day_start(now).isoformat()
