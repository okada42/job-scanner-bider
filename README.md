# Job Scanner + Job Bider

Single-user job monitor and application **preparation** assistant.

- **Scanner** watches public listing URLs you add (CrowdWorks, Lancers, Coconala).
- **FastAPI** stores jobs in **Supabase**, filters them, and notifies **Discord**.
- **Dashboard** starts/stops scanners and sets **scan interval per source**.
- **Chrome extension** opens a queued job and prepares the proposal page. It never submits.

There is no Google Sheets integration.

## Deploy split

One private GitHub monorepo. Two hosts:

| Host | What | Why |
| --- | --- | --- |
| **Railway** | Python FastAPI backend (scanner + API + WebSocket) | Needs a persistent process for the ~20s scanner loop. Not a Netlify Function. |
| **Netlify** | Static Vite dashboard (`dashboard/`) | Static SPA only. Build-time `VITE_API_URL` points at Railway. |
| **Local Chrome** | Unpacked extension (`extension/`) | Not deployed to Netlify. It talks to the Railway API / WebSocket. |

Do **not** commit `.env` or other secrets. Copy `.env.example` locally.

---

## Railway (backend)

Root `Dockerfile` + `railway.toml` already target FastAPI.

- **Root directory:** repo root (the root `Dockerfile` copies `backend/` and `supabase/`).
- **Builder:** Dockerfile (`railway.toml` sets `dockerfilePath = "Dockerfile"`).
- Railway injects `PORT`; `backend/run.py` binds to it.
- **Health check:** `/api/health`
- CORS allows all origins (`allow_origins=["*"]`), so the Netlify dashboard origin is fine.

Variables (same names as `.env.example`; never commit real values):

| Variable | Required |
| --- | --- |
| `SUPABASE_URL` | yes |
| `SUPABASE_ANON_KEY` | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | yes |
| `SUPABASE_DB_PASSWORD` | yes |
| `DISCORD_WEBHOOK_URL` | yes for Discord alerts |
| `API_TOKEN` | yes |
| `SCAN_INTERVAL_SECONDS` | optional, default `20` |

After deploy, copy the backend **public URL** (for example `https://<service>.up.railway.app`) with **no trailing slash**. That URL is what Netlify (`VITE_API_URL`) and the Chrome extension must call.

---

## Netlify (dashboard)

Connect the **same** GitHub repo. Do not deploy the extension or the Python backend here.

- **Base directory:** `dashboard`
- **Build command:** `npm run build`
- **Publish directory:** `dist`
- Root `netlify.toml` already sets those plus SPA fallback (`/*` → `/index.html`).
- **Build-time env** (Netlify Site settings → Environment variables):

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | Railway public URL, **no trailing slash** (example `https://<service>.up.railway.app`) |

`import.meta.env.VITE_API_URL` is baked in at `npm run build`. Empty means same-origin (local Vite proxy). A set value means the browser talks to Railway FastAPI directly.

Redeploy the Netlify site after changing `VITE_API_URL`.

---

## Chrome extension (local, not Netlify)

1. Open `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/`.
2. Open the extension options and set:
   - Backend URL: Railway public URL (`https`, no trailing slash) — or `http://127.0.0.1:8000` for local backend
   - Token: the same `API_TOKEN` as the backend

`host_permissions` already include `https://*.up.railway.app/*`. For a custom domain, add that origin to `extension/manifest.json` and reload.

---

## Local launch (Windows)

From the repo root. Copy `.env.example` to `.env` if you have not already, and fill secrets.

Do **not** rely on `.\.venv\Scripts\Activate.ps1`. Call the venv interpreter directly so PowerShell execution policy cannot block launch. Activate is optional: if `Activate.ps1` is blocked, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or skip activate entirely and use the paths below.

### 1. Backend (port 8000)

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe backend\scripts\migrate.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

Health check: http://127.0.0.1:8000/api/health should return `{"ok":true}`.

If uvicorn fails with `WinError 10013` (socket access forbidden), the port is already taken — usually a leftover backend from an earlier session, not a missing dependency. Check health first:

```powershell
curl http://127.0.0.1:8000/api/health
```

If that returns `{"ok":true}`, **do not start a second uvicorn**. Skip to the dashboard. To replace a stale process instead: `netstat -ano | findstr :8000` then `taskkill /PID <pid> /F`. Hyper-V can also reserve 8000 (`netsh interface ipv4 show excludedportrange protocol=tcp`); if 8000 sits in an excluded range, bind another free port (e.g. `--port 8010`) and point the Vite proxy plus the extension `backendUrl` at it.

### 2. Dashboard (port 5173)

In a second terminal:

```powershell
cd dashboard
npm install
npm run dev
```

Open http://localhost:5173 and sign in with `API_TOKEN` from the repo-root `.env`. Vite proxies `/api` to `127.0.0.1:8000`. Leave `VITE_API_URL` empty locally.

`ERR_CONNECTION_REFUSED` on 5173 means this Vite process is not running. The backend on 8000 does not serve the dashboard.

### 3. Chrome extension

Same as above, with Backend URL `http://127.0.0.1:8000` while developing against local FastAPI.

## Safety

The Bider must not generate proposals, click final submit, or bypass CAPTCHA / anti-bot. Scan interval defaults to 20s per source and is editable on the dashboard. Raise it if a platform rate-limits.
