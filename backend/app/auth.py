from fastapi import Header, HTTPException, Query, WebSocket

from app.config import settings


def require_token(x_api_token: str | None = Header(default=None, alias="X-API-Token")) -> str:
    token = x_api_token or ""
    if token != settings.api_token:
        raise HTTPException(status_code=401, detail="Invalid API token")
    return token


def ws_token(token: str | None) -> str:
    if token != settings.api_token:
        raise HTTPException(status_code=401, detail="Invalid API token")
    return token


async def accept_ws(websocket: WebSocket, token: str | None = Query(default=None)) -> None:
    if token != settings.api_token:
        await websocket.close(code=1008)
        raise HTTPException(status_code=401, detail="Invalid API token")
    await websocket.accept()
