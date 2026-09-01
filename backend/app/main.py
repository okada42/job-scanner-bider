from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.jobs import router as jobs_router
from app.api.scanners import router as scanners_router
from app.api.settings import router as settings_router
from app.auth import accept_ws
from app.core.scanner import bider_payload, claim_next_job
from app.core.scheduler import start_scheduler, stop_scheduler_loop
from app.integrations.hub import hub
from app.store import queued_jobs


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler_loop()


app = FastAPI(title="Job Scanner + Bider", lifespan=lifespan)
# Token is sent in X-API-Token, not cookies. Browsers block allow_origins=["*"]
# combined with allow_credentials=True, which would break Netlify → Railway login.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Token", "Authorization", "Accept"],
)
app.include_router(scanners_router)
app.include_router(jobs_router)
app.include_router(settings_router)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.websocket("/ws/bider")
async def ws_bider(websocket: WebSocket, token: str | None = None):
    await accept_ws(websocket, token)
    await hub.connect(websocket)
    await websocket.send_json(
        {
            "event": "HELLO",
            "pending": [bider_payload(j) for j in queued_jobs(20)],
        }
    )
    try:
        while True:
            data = await websocket.receive_json()
            action = (data or {}).get("action")
            if action == "CLAIM":
                job = claim_next_job()
                await websocket.send_json({"event": "CLAIM_RESULT", "job": bider_payload(job) if job else None})
            elif action == "PING":
                await websocket.send_json({"event": "PONG"})
    except WebSocketDisconnect:
        await hub.disconnect(websocket)
    except Exception:
        await hub.disconnect(websocket)
