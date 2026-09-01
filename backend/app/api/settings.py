from fastapi import APIRouter, Depends

from app.auth import require_token
from app.schemas import BiderSettingsUpdate, LoginBody, ScannerControlUpdate
from app.config import settings
from app.store import get_bider_settings, get_control, update_bider_settings, update_control

router = APIRouter(prefix="/api")


@router.post("/auth/login")
def login(body: LoginBody):
    ok = body.token == settings.api_token
    return {"ok": ok}


@router.get("/settings", dependencies=[Depends(require_token)])
def settings_get():
    return {
        "scanner": get_control(),
        "bider": get_bider_settings(),
        "default_scan_interval": settings.scan_interval_seconds,
    }


@router.put("/settings", dependencies=[Depends(require_token)])
def settings_put(body: BiderSettingsUpdate):
    patch = body.model_dump(exclude_none=True)
    return update_bider_settings(patch)


@router.put("/settings/scanner", dependencies=[Depends(require_token)])
def scanner_settings_put(body: ScannerControlUpdate):
    patch = body.model_dump(exclude_none=True)
    return update_control(patch)
