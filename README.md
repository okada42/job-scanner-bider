# Job Scanner + Job Bider

Single-user job monitor and application **preparation** assistant.

- **Scanner** crawls listing-search URLs you add (CrowdWorks, Lancers, Coconala). The **first successful crawl is a baseline**: every job already on that page is stored as seen and ignored. After that, only jobs that are **not** already in the jobs table (Supabase, or local SQLite when Supabase is unset) are treated as new. Login-required pages still need the Chrome extension (browser cookies). The backend never stores platform passwords. There is no Google Sheets integration.
- **FastAPI** stores jobs in **Supabase**, filters them, and notifies **Discord**. New jobs also arrive via `POST /api/jobs/ingest` (`X-API-Token`).
- **Dashboard** starts/stops the optional Railway HTML scanner, paginates the jobs table (10 or 20 rows), and sets **scan interval per source**.
- **Chrome extension** (one install, two toggles): **Enable scan** and **Enable apply (Bider)**. It never submits.

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
- CORS allows all origins (`allow_origins=["*"]`, `allow_credentials=False`) so the Netlify dashboard can call Railway with `X-API-Token`.

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
| `SCAN_MODE` | optional, `html` (default) or `extension`. `extension` skips Railway’s automatic anonymous HTML fetch; jobs still arrive from the extension ingest API. |

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

Netlify needs `VITE_API_URL` set to the Railway public URL and a rebuild; local Vite needs none because `/api` is proxied.

`import.meta.env.VITE_API_URL` is baked in at `npm run build`. Empty means same-origin (local Vite proxy). A set value means the browser talks to Railway FastAPI directly.

Redeploy the Netlify site after changing `VITE_API_URL`. After a CORS change, wait for Railway to auto-deploy from GitHub, then Redeploy Netlify.

---

## Chrome extension (local, not Netlify)

The unpacked extension lives in the repo folder **`extension/`** (same level as `dashboard/` and `backend/`). It is not hosted on Netlify.

Use **two Chrome profiles**, same unpacked extension, opposite toggles.

| Profile | Enable scan | Enable apply (Bider) | Role |
| --- | --- | --- | --- |
| **Search** | ON | OFF | Stay logged in on CrowdWorks / Lancers / Coconala. The extension `fetch`es listing URLs with this profile’s cookies (does not navigate your tabs) and POSTs jobs to `/api/jobs/ingest`. |
| **Apply** | OFF | ON | Opens queued jobs from the shared Railway queue and prepares the proposal page. Does not scan. Never submits. |

Defaults: both toggles **off**. The default Backend URL is the production Railway API. Turn the toggles on per profile after you paste the token.

1. `git pull` this repo on the machine that runs Chrome (this cloud workspace is not your Chrome).
2. Open `chrome://extensions` → enable Developer mode → **Load unpacked** → select the `extension/` folder (the one that contains `manifest.json`). After an update, click **Reload**.
3. Open **Options** (side panel **Options** button, or right-click the extension):
   - Backend URL: `https://job-scanner-bider-production.up.railway.app` (no trailing slash). Do **not** paste the Netlify dashboard URL. Use `http://127.0.0.1:8000` only if FastAPI is running on that same computer.
   - Token: the same `API_TOKEN` as the dashboard
   - Click **Test connection** — success means FROM DATABASE and NEXT can reach Railway
   - The two toggles as in the table above

**FROM DATABASE: Failed to fetch** means Chrome never reached the API (usually leftover `127.0.0.1:8000` or the Netlify site). It is not an empty database. After reload, the extension remaps those URLs to Railway and shows the real error (missing token, 401, or no queued job).

The search profile **must stay logged in**. Railway’s HTML GET is anonymous; if the search session expires, ingest will see login pages and find no jobs.

**Alarm interval:** dashboard source intervals are honored as much as Manifest V3 allows. `chrome.alarms` typically cannot fire faster than **30 seconds** (unpacked) or **1 minute** (packed). A 60s dashboard interval therefore becomes ~1 minute. The extension also stores per-source last-run times and will not fetch a source again until its interval has elapsed.

The popup and side panel **FROM DATABASE** list is `GET /api/jobs` — the same table the dashboard uses. Scan still POSTs new listings into that table; it does not keep a second copy.

**Who opens tabs (dashboard Mode):** the Bider card's **Mode** is the single switch for every Chrome profile. **auto**: the extension keeps **Max active** job tabs open by itself — a new-job alert, the 30-second top-up, and the next queued URL after you skip or close a tab all open tabs. **semi-auto** (the default): scanned jobs open only when you click **Fill window**, **Next**, or **Open**; URLs pasted into the dashboard Bider inbox are explicit requests and still open in the extension by themselves (over the websocket, or on the next 30-second check if the websocket was down), once each per day. **paused**: the extension claims and opens nothing.

**Starting from an empty database:** the job tables (`jobs`, `job_events`, `bider_claims`, `bider_actors`) can be truncated at any time; settings (`bider_settings`, `scanner_control` with excluded clients, `scanner_sources`) are separate and survive. The intended flow is: paste job URLs into the dashboard Bider card → `POST /api/jobs/manual` stores them as `QUEUED` with priority ≥ 100 → the extension (Bider on, a name set) opens each one and prepares the proposal page exactly as for scanned jobs. Reload the unpacked extension **0.4.4** after `git pull`. A tab that disappears while Chrome is closed or the extension is asleep is parked as **closed**, never reopened. Adapter clicks (応募画面へ / 提案する) never count as "sent"; only your own click on a submit button does. Before 0.4.3 the extension ignored Mode (`force=true`) and reopened vanished tabs, which is why tabs appeared on their own while the dashboard said semi-auto.

**CrowdWorks apply (never submits):** Set **Max active** on the dashboard (for example `3`). On the Apply profile, **Fill window** opens that many queued URLs. In Mode auto, a new-job alert (Discord / websocket) also opens queued URLs until that cap if fewer tabs are open. Paste job URLs into the Bider inbox (one per line) to push them to the front of the queue and open them immediately as extra tabs (violet URL). Each JOB BIDER row stays compact: URL, `本✓` / `発✓`, `⏰` hourly or `💰` fixed, `掲` / `締` dates, plus **queued / ready / sent / skipped / closed**. Sent, skipped, and closed lists are collapsed. Focus brings that job’s tab and window to the front. After a URL is opened once, a third line shows 募集実績 and 完了率. Every wait inside the extension is **under one second** (0.3–0.7 s before 応募画面へ / 提案する and before 完了予定日; hourly jobs skip the date). Never fills 契約金額. A CrowdWorks `/proposals/{id}` URL after submit is treated as sent. CrowdWorks and Coconala do not gate on login. If Lancers shows ログイン / 会員登録, the extension toasts `Lancersにログインしてください` and pauses Lancers scan/open only. The extension does **not** reload Lancers tabs on a timer.

**Lancers apply (never submits):** On a `/work/detail/` page the extension collects only budget (`プロジェクト ~ …円`) and client info (`.p-work-detail-client-box__inner` / `.client_name`, plus 発注率). It does not scrape the title or 依頼詳細. It clicks **提案する**. On `/work/propose_start/` it never clicks **詳細** / 続きを読む / 詳細を書く. It only clears **提案文** and sets **完了予定日** from 希望納期, or start + one month. It never fills **契約金額** and never submits. Reload unpacked extension **0.4.4** after `git pull`. CrowdWorks: on the proposal page the extension clicks nothing (it no longer opens 新しいテンプレートを作成, whose link points at `/u/message_templates/new.json` and could turn the job tab into a raw JSON page; a tab that lands there is sent back automatically). It never writes into any `<input>` (契約金額（税抜） included); only the proposal `<textarea>` and the 完了予定日 selects are touched. Lancers 完了予定日: the field is found by document order after the label; it handles year/month/day selects, `<input type=date>`, plain text inputs (`yyyy/mm/dd`, ISO, or 年月日 to match the current format), and read-only datepicker inputs by opening the calendar, moving to the right month, and clicking the day. The **Enable apply (Bider)** toggle stays off until you turn it on.

**Your name (per Chrome profile):** Options → **Your name**. The extension no longer reads your CrowdWorks / Lancers user name from the page. The name you type is stored only in that Chrome profile, sent as `X-Bider-Actor`, and shown on the dashboard as `kenji queued` / `kenji ready` / `kenji skipped`. Job Bider does not start until a name is set.

**Daily reset:** the backend expires every `QUEUED` / in-flight Bider job that was detected before **today's Japan midnight** (`EXPIRED`, with a `job_events` row) at startup and once per day, and the Bider queue only serves jobs detected today. Re-pasting a URL into the Bider inbox makes it today's job again. The dashboard hides expired rows and shows how many were hidden. `GET /api/scanners` reports `claims_store` (the `bider_claims` / `bider_actors` tables exist) and the last `rollover`. If `claims_store` is `false`, run `backend/scripts/migrate.py` once; per-user status is silently disabled without those tables.

`host_permissions` already include `https://*.up.railway.app/*`. For a custom domain, add that origin to `extension/manifest.json` and reload.

Multi-profile Bider uses table `bider_claims` (job URL + logged-in user name). Apply `supabase/migrations/004_bider_claims.sql` on the production database if that table is missing.

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

### 2. Dashboard (port 43123)

In a second terminal:

```powershell
cd dashboard
npm install
npm run dev
```

Open http://127.0.0.1:43123 and sign in with `API_TOKEN` from the repo-root `.env`. Vite proxies `/api` to `127.0.0.1:8000`. Leave `VITE_API_URL` empty locally.

The jobs table sits at the top of the page under Bider mode, max active, and the manual URL inbox. The table shows only **today's jobs (Japan time) plus manually added URLs**; earlier days are hidden (`GET /api/jobs?today_only=false` returns everything). Status is per Chrome-profile name typed in the extension Options (`kenji queued`, `kenji skipped`, `kenji ready`) and resets at midnight Japan time; older Bider jobs are expired. Use **10** or **20** rows per page (default 20). Polls keep the last good rows on screen; they do not blank the table.

`ERR_CONNECTION_REFUSED` on 43123 means this Vite process is not running. The backend on 8000 does not serve the dashboard.

### 3. Chrome extension

Same as above, with Backend URL `http://127.0.0.1:8000` while developing against local FastAPI.

## Safety

The Bider must not generate proposals, click final submit, or bypass CAPTCHA / anti-bot. Scan interval defaults to **60 seconds** per source and is editable on the dashboard. Raise it if a platform rate-limits.

## How “new job” is decided

1. You paste a **search-results URL** on the dashboard (not a single job page).
2. The backend `GET`s that URL, parses job cards (id + URL) for CrowdWorks `/public/jobs/{id}`, Lancers `/work/detail/{id}`, and Coconala `/requests/{id}`. The Chrome extension can do the same fetch with your login cookies and `POST /api/jobs/ingest`.
3. **First crawl** with at least one parsed job: write those ids into the jobs table as `RECORDED` / `BASELINE`. No Discord. No bider queue. Those listings already existed when monitoring started.
4. **Later crawls:** skip any job whose `(platform, external_job_id)` or URL is already stored. A job that is **not** in the database is a new posting: **write it to the database, then Discord**. Keyword/budget rules only affect the Bider queue, not Discord. If the webhook fails, the job stays in the DB and Discord is retried on the next crawl of that URL (~0.4s between posts so bursts are not dropped).
5. **Bad clients:** names you add on the dashboard. If a new job’s client contains any of those names, it is stored as seen and skipped (no queue, no Discord).
6. If the first crawl parses **zero** jobs (login wall or empty page), the baseline is **not** marked complete, so a later successful parse is not treated as a flood of “new” jobs.
7. **Found** on the Sources table is **new jobs recorded today** for that URL (resets at midnight Japan time). The first crawl’s baseline listings are not counted. The grey **listed** number is the platform’s current catalog total.
8. The **dashboard** and **Chrome extension** read jobs from the same API/database. Discord is an alert only; it is not a second source of listings.

Without real `SUPABASE_*` values the backend uses a local SQLite file at `data/job-scanner.db`.
