from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import require_token
from app.core.scanner import scan_source
from app.core.scheduler import scheduler_alive
from app.db import PLATFORMS
from app.platforms.registry import detect_platform
from app.schemas import SourceCreate, SourceUpdate
from app.store import (
    delete_source,
    get_control,
    get_source,
    insert_source,
    job_counts_by_source,
    list_sources,
    update_control,
    update_source,
)


async def _baseline_scan(source: dict) -> None:
    try:
        await scan_source(source)
    except Exception as exc:
        update_source(source["id"], {"last_error": str(exc)[:500]})

def _sources_with_found() -> list[dict]:
    sources = list_sources()
    counts = job_counts_by_source()
    out = []
    for source in sources:
        row = dict(source)
        stored = int(counts.get(str(source.get("id")), 0) or 0)
        row["job_count"] = stored
        row["found"] = stored
        out.append(row)
    return out


router = APIRouter(prefix="/api", dependencies=[Depends(require_token)])


@router.get("/scanners")
def scanners():
    control = get_control()
    return {
        "control": control,
        "scheduler": scheduler_alive(),
        "platforms": {p: (control.get("platforms") or {}).get(p, True) for p in PLATFORMS},
        "sources": _sources_with_found(),
    }


@router.get("/scanners/status")
def scanners_status():
    return scanners()


@router.post("/scanners/start")
def start_all():
    return update_control({"enabled": True})


@router.post("/scanners/stop")
def stop_all():
    return update_control({"enabled": False})


@router.post("/scanners/platforms/{platform}/start")
def start_platform(platform: str):
    if platform not in PLATFORMS:
        raise HTTPException(400, "Unknown platform")
    control = get_control()
    platforms = dict(control.get("platforms") or {})
    platforms[platform] = True
    return update_control({"platforms": platforms, "enabled": True})


@router.post("/scanners/platforms/{platform}/stop")
def stop_platform(platform: str):
    if platform not in PLATFORMS:
        raise HTTPException(400, "Unknown platform")
    control = get_control()
    platforms = dict(control.get("platforms") or {})
    platforms[platform] = False
    return update_control({"platforms": platforms})


@router.get("/sources")
def sources():
    return _sources_with_found()


@router.post("/sources")
def create_source(body: SourceCreate, background_tasks: BackgroundTasks):
    detected = detect_platform(str(body.url))
    if detected and detected != body.platform:
        raise HTTPException(400, f"URL looks like {detected}, not {body.platform}")
    row = {
        "name": body.name,
        "platform": body.platform,
        "url": str(body.url),
        "enabled": body.enabled,
        "scan_interval": max(5, body.scan_interval),
        "rules": body.rules.model_dump(),
    }
    created = insert_source(row)
    background_tasks.add_task(_baseline_scan, created)
    return created


@router.patch("/sources/{source_id}")
def patch_source(source_id: str, body: SourceUpdate):
    if not get_source(source_id):
        raise HTTPException(404, "Source not found")
    patch = body.model_dump(exclude_none=True)
    if "url" in patch:
        patch["url"] = str(patch["url"])
    if "scan_interval" in patch:
        patch["scan_interval"] = max(5, int(patch["scan_interval"]))
    if "rules" in patch and hasattr(body.rules, "model_dump"):
        patch["rules"] = body.rules.model_dump()
    return update_source(source_id, patch)


@router.delete("/sources/{source_id}")
def remove_source(source_id: str):
    if not get_source(source_id):
        raise HTTPException(404, "Source not found")
    delete_source(source_id)
    return {"ok": True}


@router.post("/sources/{source_id}/scan")
async def scan_now(source_id: str):
    source = get_source(source_id)
    if not source:
        raise HTTPException(404, "Source not found")
    try:
        return await scan_source(source)
    except Exception as exc:
        update_source(source_id, {"last_error": str(exc)[:500]})
        raise HTTPException(502, str(exc))
