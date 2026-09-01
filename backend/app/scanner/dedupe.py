from typing import Any

from app.db import db


def find_existing(platform: str, external_job_id: str, url: str) -> dict[str, Any] | None:
    client = db()
    if external_job_id:
        res = (
            client.table("jobs")
            .select("*")
            .eq("platform", platform)
            .eq("external_job_id", external_job_id)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]
    res = client.table("jobs").select("*").eq("platform", platform).eq("url", url).limit(1).execute()
    return res.data[0] if res.data else None
