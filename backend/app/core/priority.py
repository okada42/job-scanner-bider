MANUAL_PRIORITY = 100


def is_manual_job(job: dict | None) -> bool:
    try:
        return int((job or {}).get("priority") or 0) >= MANUAL_PRIORITY
    except (TypeError, ValueError):
        return False
