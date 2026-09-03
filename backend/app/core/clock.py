import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.config import settings

DEFAULT_SCANNER_TZ = "Asia/Tokyo"
_JP_WHEN = re.compile(
    r"(?P<y>\d{4})年\s*(?P<m>\d{1,2})月\s*(?P<d>\d{1,2})日"
    r"(?:\s*[月火水木金土日]曜日)?"
    r"(?:\s*(?P<h>\d{1,2}):(?P<min>\d{2}))?"
)
_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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


def parse_when(value) -> datetime | None:
    """Parse a listing timestamp (ISO, date-only, or CrowdWorks/Coconala Japanese title)."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=scanner_zone())
        return dt
    raw = str(value).strip()
    if not raw:
        return None
    jp = _JP_WHEN.search(raw)
    if jp:
        return datetime(
            int(jp.group("y")),
            int(jp.group("m")),
            int(jp.group("d")),
            int(jp.group("h") or 0),
            int(jp.group("min") or 0),
            tzinfo=scanner_zone(),
        )
    try:
        if _DATE_ONLY.fullmatch(raw):
            return datetime.fromisoformat(f"{raw}T00:00:00").replace(tzinfo=scanner_zone())
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=scanner_zone())
    return dt


def format_local_when(value) -> str | None:
    raw = str(value).strip() if value is not None and not isinstance(value, datetime) else ""
    dt = parse_when(value)
    if not dt:
        return None
    local = dt.astimezone(scanner_zone())
    if _DATE_ONLY.fullmatch(raw):
        return local.strftime("%Y-%m-%d")
    return local.strftime("%Y-%m-%d %H:%M")
