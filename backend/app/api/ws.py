from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.auth import ws_token
from app.realtime import hub
from app.scanner.queue import pending_for_bider

router = APIRouter()


@router.websocket("/ws/bider")
async def bider_socket(websocket: WebSocket):
    await ws_token(websocket)
    await hub.connect_bider(websocket)
    try:
        await websocket.send_json({"event": "hello", "pending": pending_for_bider()})
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        hub.drop(websocket)
    except Exception:
        hub.drop(websocket)


@router.websocket("/ws/dashboard")
async def dashboard_socket(websocket: WebSocket):
    await ws_token(websocket)
    await hub.connect_dashboard(websocket)
    try:
        await websocket.send_json({"event": "hello"})
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        hub.drop(websocket)
    except Exception:
        hub.drop(websocket)
