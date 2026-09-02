from __future__ import annotations

import re

from app.schemas import Rules

_YEAR = re.compile(r"^20\d{2}$")


def parse_budget_bounds(text: str | None) -> tuple[int | None, int | None]:
    if not text:
        return None, None
    nums: list[int] = []
    for raw in re.findall(r"\d{1,3}(?:,\d{3})+|\d+", text):
        n = int(raw.replace(",", ""))
        if _YEAR.match(str(n)):
            continue
        if n < 100:
            continue
        nums.append(n)
    if not nums:
        return None, None
    return min(nums), max(nums)


def normalize_client_names(names: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in names or []:
        name = str(raw or "").strip()
        key = name.lower()
        if not name or key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def client_is_excluded(client: str | None, names: list[str] | None) -> bool:
    hay = (client or "").strip().lower()
    if not hay:
        return False
    for name in normalize_client_names(names):
        needle = name.lower()
        if needle and needle in hay:
            return True
    return False


def job_matches(job: dict, rules: Rules | dict | None) -> tuple[bool, str]:
    data = {} if not rules else (rules if isinstance(rules, dict) else rules.model_dump())
    if client_is_excluded(job.get("client"), data.get("excluded_clients")):
        return False, "bad_client"
    title = (job.get("title") or "") + " " + (job.get("client") or "")
    keywords = [k for k in (data.get("keywords") or []) if k]
    if keywords and not any(k.lower() in title.lower() for k in keywords):
        return False, "keywords"

    low, high = parse_budget_bounds(job.get("budget"))
    min_b = data.get("minimum_budget")
    max_b = data.get("maximum_budget")
    if min_b is not None:
        comparable = high if high is not None else low
        if comparable is None or comparable < int(min_b):
            return False, "minimum_budget"
    if max_b is not None:
        comparable = low if low is not None else high
        if comparable is None or comparable > int(max_b):
            return False, "maximum_budget"

    max_apps = data.get("maximum_applications")
    apps = job.get("application_count")
    if max_apps is not None and apps is not None and int(apps) > int(max_apps):
        return False, "maximum_applications"

    category = data.get("category")
    if category and job.get("category") and category.lower() not in str(job["category"]).lower():
        return False, "category"
    return True, "ok"
