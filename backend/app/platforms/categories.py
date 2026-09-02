from __future__ import annotations

from urllib.parse import parse_qs, urlparse

# CrowdWorks search category_id → (bracket suffix, title tag)
CW_CATEGORIES = {
    225: ("Biz", "biz"),
    226: ("Dev", "dev"),
    228: ("Writing", "writing"),
    229: ("Office", "office"),
    230: ("Web", "web"),
    231: ("Design", "design"),
    232: ("DTP", "dtp"),
    233: ("Image", "image"),
    234: ("SEM", "sem"),
    235: ("EC", "ec"),
    236: ("Consult", "consult"),
    237: ("Support", "support"),
    238: ("Translate", "translate"),
    239: ("Sales", "sales"),
    240: ("Research", "research"),
    241: ("Web", "web"),
    242: ("App", "app"),
    282: ("Data", "data"),
}


def category_id_from_url(url: str | None) -> int | None:
    if not url:
        return None
    qs = parse_qs(urlparse(url).query)
    raw = (qs.get("category_id") or [None])[0]
    try:
        return int(raw) if raw else None
    except (TypeError, ValueError):
        return None


def crowdworks_category(category_id, source_url: str | None = None) -> tuple[str, str]:
    for cid in (category_id, category_id_from_url(source_url)):
        try:
            key = int(cid)
        except (TypeError, ValueError):
            continue
        if key in CW_CATEGORIES:
            return CW_CATEGORIES[key]
    return ("Web", "web")
