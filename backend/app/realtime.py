from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass
class Hub:
    bider: list[WebSocket] = field(default_factory=list)
    dashboard: list[WebSocket] = field(default_factory=list)

    async def connect_bider(self, ws: WebSocket):
        await ws.accept()
        self.bider.append(ws)

    async def connect_dashboard(self, ws: WebSocket):
        await ws.accept()
        self.dashboard.append(ws)

    def drop(self, ws: WebSocket):
        if ws in self.bider:
            self.bider.remove(ws)
        if ws in self.dashboard:
            self.dashboard.remove(ws)

    async def broadcast_bider(self, payload: dict[str, Any]):
        await _send(self.bider, payload)

    async def broadcast_dashboard(self, payload: dict[str, Any]):
        await _send(self.dashboard, payload)


async def _send(sockets: list[WebSocket], payload: dict[str, Any]):
    dead = []
    for ws in sockets:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in sockets:
            sockets.remove(ws)


hub = Hub()
