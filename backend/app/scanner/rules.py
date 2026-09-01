from typing import Any

from app.scanner.budget import parse_budget_range


def job_matches(job: dict[str, Any], rules: dict[str, Any] | None) -> bool:
    rules = rules or {}
    bmin, bmax = job.get("budget_min"), job.get("budget_max")
    if bmin is None and bmax is None:
        bmin, bmax = parse_budget_range(job.get("budget"))

    min_budget = rules.get("minimum_budget")
    if min_budget not in (None, "", 0):
        ceiling = bmax if bmax is not None else bmin
        if ceiling is None or int(ceiling) < int(min_budget):
            return False

    max_budget = rules.get("maximum_budget")
    if max_budget not in (None, ""):
        floor = bmin if bmin is not None else bmax
        if floor is None or int(floor) > int(max_budget):
            return False

    max_apps = rules.get("maximum_applications")
    if max_apps not in (None, ""):
        count = job.get("application_count")
        if count is not None and int(count) > int(max_apps):
            return False

    keywords = rules.get("keywords") or []
    if isinstance(keywords, str):
        keywords = [k.strip() for k in keywords.split(",") if k.strip()]
    if keywords:
        hay = " ".join(filter(None, [job.get("title"), job.get("client"), job.get("category")])).lower()
        if not any(k.lower() in hay for k in keywords):
            return False

    category = rules.get("category")
    if category:
        actual = (job.get("category") or "").lower()
        if category.lower() not in actual:
            return False

    return True
