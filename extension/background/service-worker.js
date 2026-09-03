importScripts("../shared/backend.js");
importScripts("../shared/dates.js");
importScripts("listing-parse.js");

const DEFAULTS = {
  backendUrl: PRODUCTION_API,
  token: "",
  running: false,
  applyEnabled: false,
  scanEnabled: false,
  paused: false,
  currentJob: null,
};

const SCAN_ALARM = "listing-scan";
const BIDER_ALARM = "bider-keepalive";
const CHROME_ALARM_FLOOR_MIN = 0.5;

function jobsFromApi(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.jobs)) return data.jobs;
  return [];
}

async function cfg() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const merged = { ...DEFAULTS, ...stored };
  merged.applyEnabled = Boolean(merged.applyEnabled || merged.running);
  merged.backendUrl = normalizeBackendUrl(merged.backendUrl);
  return merged;
}

let ws = null;
let scanning = false;

async function connect() {
  const c = await cfg();
  if (!c.applyEnabled || c.paused) return;
  if (!c.token || !c.backendUrl) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = c.backendUrl.replace(/^http/, "ws") + "/ws/bider?token=" + encodeURIComponent(c.token);
  ws = new WebSocket(url);
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.event === "NEW_JOB") {
      const settings = await cfg();
      if (!settings.applyEnabled || settings.paused) return;
      await maybeOpen(msg.job);
    }
  };
  ws.onclose = () => {
    ws = null;
  };
}

function disconnectWs() {
  if (ws) {
    try {
      ws.close();
    } catch (_) {
      /* ignore */
    }
    ws = null;
  }
}

async function fetchApi(base, path, options, token) {
  const url = `${base}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-Token": token,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    throw new Error(describeFetchError(err, base));
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Invalid API token (401). Use the same token as the dashboard.");
    }
    throw new Error((text || `HTTP ${res.status}`).slice(0, 280));
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(
      `Got a webpage instead of the API from ${base}. Set Backend URL to ${PRODUCTION_API}, not the Netlify dashboard.`
    );
  }
}

async function api(path, options = {}) {
  const c = await cfg();
  if (!c.token) {
    throw new Error(
      "API token is empty. Right-click the extension → Options and paste the same token as the dashboard."
    );
  }
  const base = c.backendUrl;
  try {
    return await fetchApi(base, path, options, c.token);
  } catch (err) {
    if (!isLocalhostBackend(base)) throw err;
    try {
      const data = await fetchApi(PRODUCTION_API, path, options, c.token);
      await chrome.storage.sync.set({ backendUrl: PRODUCTION_API });
      disconnectWs();
      connect();
      return data;
    } catch (_) {
      throw err;
    }
  }
}

async function migrateLocalhostIfUnreachable() {
  const stored = await chrome.storage.sync.get({ backendUrl: DEFAULTS.backendUrl });
  const url = normalizeBackendUrl(stored.backendUrl);
  if (!isLocalhostBackend(url)) return;
  try {
    const res = await fetch(`${url}/api/health`);
    if (res.ok) return;
  } catch (_) {
    /* local API is down */
  }
  try {
    const res = await fetch(`${PRODUCTION_API}/api/health`);
    if (res.ok) {
      await chrome.storage.sync.set({ backendUrl: PRODUCTION_API });
      disconnectWs();
      connect();
    }
  } catch (_) {
    /* keep saved URL */
  }
}

async function maybeOpen(job) {
  const c = await cfg();
  if (!job) return;
  if (!c.applyEnabled || c.paused) return;
  if (c.currentJob && c.currentJob.id !== job.id) return;
  await chrome.storage.sync.set({ currentJob: job });
  await chrome.storage.local.set({ pageExtract: null });
  const tab = await chrome.tabs.create({ url: job.url, active: true });
  await api(`/api/jobs/${job.id}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "PROCESSING" }),
  });
  if (tab?.id) await runApplyFlow(tab.id);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || (tab && tab.status === "complete")) {
        finish();
        return;
      }
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(finish, timeoutMs);
    });
  });
}

async function sendToTab(tabId, msg, tries = 10) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res) return res;
    } catch (_) {
      /* content script may not be injected yet */
    }
    await sleep(350);
  }
  return { ok: false, error: "Page script did not respond." };
}

async function rememberExtract(extract) {
  if (!extract) return;
  await chrome.storage.local.set({ pageExtract: extract });
}

async function runApplyFlow(tabId) {
  await waitTabComplete(tabId);
  let extract = null;
  let first = await sendToTab(tabId, { type: "AUTO_APPLY" });
  if (first?.extract) {
    extract = first.extract;
    await rememberExtract(extract);
  }
  if (first?.stage === "clicked_apply") {
    await waitTabComplete(tabId);
    const second = await sendToTab(tabId, { type: "AUTO_APPLY", extract });
    if (second?.extract) await rememberExtract(second.extract);
    return second;
  }
  return first;
}

async function claimAndOpen() {
  const c = await cfg();
  if (!c.applyEnabled) {
    return { ok: false, error: "Enable apply (Bider) in the popup first." };
  }
  if (c.paused) {
    return { ok: false, error: "Bider is paused. Click Resume in the popup." };
  }
  const data = await api("/api/jobs/next");
  if (!data.job) {
    return {
      ok: true,
      job: null,
      error:
        "No queued job. On the dashboard, turn Bider ON (not paused) and wait for a new match to enter the queue.",
    };
  }
  await maybeOpen(data.job);
  return { ok: true, job: data.job };
}

async function setApplyEnabled(enabled) {
  const patch = { applyEnabled: Boolean(enabled), running: Boolean(enabled) };
  if (enabled) patch.paused = false;
  await chrome.storage.sync.set(patch);
  if (enabled) {
    await connect();
    return claimAndOpen();
  }
  disconnectWs();
  return { ok: true };
}

async function scheduleScanAlarm() {
  const c = await cfg();
  await chrome.alarms.clear(SCAN_ALARM);
  if (!c.scanEnabled) return;
  let periodInMinutes = CHROME_ALARM_FLOOR_MIN;
  try {
    const data = await api("/api/scanners");
    const sources = (data.sources || []).filter((s) => s.enabled);
    if (sources.length) {
      const minSec = Math.min(...sources.map((s) => Number(s.scan_interval) || 60));
      periodInMinutes = Math.max(CHROME_ALARM_FLOOR_MIN, minSec / 60);
    }
  } catch (_) {
    /* keep Chrome floor */
  }
  await chrome.alarms.create(SCAN_ALARM, { periodInMinutes });
}

async function setScanStatus(patch) {
  const prev = (await chrome.storage.local.get({ scanStatus: null })).scanStatus || {};
  await chrome.storage.local.set({ scanStatus: { ...prev, ...patch, at: new Date().toISOString() } });
}

async function runListingScan() {
  const c = await cfg();
  if (!c.scanEnabled || scanning) return;
  scanning = true;
  try {
    const data = await api("/api/scanners");
    const platforms = data.platforms || {};
    const sources = (data.sources || []).filter((s) => s.enabled && platforms[s.platform] !== false);
    const now = Date.now();
    const lastRuns = (await chrome.storage.local.get({ lastScanRuns: {} })).lastScanRuns || {};
    let found = 0;
    let created = 0;
    let queued = 0;
    let lastError = null;

    for (const source of sources) {
      const intervalMs = Math.max(5, Number(source.scan_interval) || 60) * 1000;
      const last = Number(lastRuns[source.id] || 0);
      if (last && now - last < intervalMs) continue;
      try {
        const res = await fetch(source.url, { credentials: "include", redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${source.platform}`);
        const html = await res.text();
        const jobs = parseListingJobs(html, source.platform);
        const result = await api("/api/jobs/ingest", {
          method: "POST",
          body: JSON.stringify({ source_id: source.id, jobs }),
        });
        found += result.found ?? jobs.length;
        created += result.created ?? 0;
        queued += result.queued ?? 0;
        lastRuns[source.id] = Date.now();
      } catch (err) {
        lastError = String(err && err.message ? err.message : err).slice(0, 300);
      }
    }

    await chrome.storage.local.set({ lastScanRuns });
    await setScanStatus({ found, created, queued, error: lastError });
  } catch (err) {
    await setScanStatus({ error: String(err && err.message ? err.message : err).slice(0, 300) });
  } finally {
    scanning = false;
  }
}

async function testConnection() {
  const c = await cfg();
  const base = c.backendUrl;
  try {
    const res = await fetch(`${base}/api/health`);
    if (!res.ok) throw new Error(`Health check HTTP ${res.status}`);
    await res.json();
  } catch (err) {
    if (isLocalhostBackend(base)) {
      try {
        const res = await fetch(`${PRODUCTION_API}/api/health`);
        if (res.ok) {
          await chrome.storage.sync.set({ backendUrl: PRODUCTION_API });
          return testConnection();
        }
      } catch (_) {
        /* fall through */
      }
    }
    return { ok: false, error: describeFetchError(err, base), backendUrl: base };
  }
  if (!c.token) {
    return {
      ok: false,
      error: "API is reachable, but the token is empty. Paste the same token as the dashboard.",
      backendUrl: base,
    };
  }
  try {
    const data = await api("/api/jobs?limit=1&new_only=true");
    const jobs = jobsFromApi(data);
    return {
      ok: true,
      backendUrl: (await cfg()).backendUrl,
      jobs: jobs.length,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), backendUrl: base };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create(BIDER_ALARM, { periodInMinutes: 1 });
  migrateLocalhostIfUnreachable();
  scheduleScanAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  migrateLocalhostIfUnreachable();
  scheduleScanAlarm();
  connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BIDER_ALARM) connect();
  if (alarm.name === SCAN_ALARM) runListingScan();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "START") {
      try {
        const result = await setApplyEnabled(true);
        sendResponse({ ok: Boolean(result?.ok !== false), ...result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    } else if (msg.type === "SET_APPLY") {
      try {
        const result = await setApplyEnabled(Boolean(msg.enabled));
        sendResponse({ ok: Boolean(result?.ok !== false), ...result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    } else if (msg.type === "SET_SCAN") {
      await chrome.storage.sync.set({ scanEnabled: Boolean(msg.enabled) });
      await scheduleScanAlarm();
      if (msg.enabled) await runListingScan();
      sendResponse({ ok: true });
    } else if (msg.type === "CONFIG_CHANGED") {
      await migrateLocalhostIfUnreachable();
      await scheduleScanAlarm();
      const c = await cfg();
      if (c.scanEnabled) await runListingScan();
      if (c.applyEnabled && !c.paused) await connect();
      else disconnectWs();
      sendResponse({ ok: true, backendUrl: c.backendUrl });
    } else if (msg.type === "PAUSE") {
      await chrome.storage.sync.set({ paused: true });
      sendResponse({ ok: true });
    } else if (msg.type === "RESUME") {
      await chrome.storage.sync.set({ paused: false, running: true, applyEnabled: true });
      await connect();
      sendResponse({ ok: true });
    } else if (msg.type === "SKIP" || msg.type === "NEXT") {
      try {
        const c = await cfg();
        if (c.currentJob) {
          await api(`/api/jobs/${c.currentJob.id}/status`, {
            method: "POST",
            body: JSON.stringify({ status: msg.type === "SKIP" ? "SKIPPED" : "COMPLETED" }),
          });
        }
        await chrome.storage.sync.set({ currentJob: null });
        await chrome.storage.local.set({ pageExtract: null });
        const result = await claimAndOpen();
        sendResponse({ ok: Boolean(result.ok), ...result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    } else if (msg.type === "PREPARE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      const stored = (await chrome.storage.local.get({ pageExtract: null })).pageExtract;
      const res = await sendToTab(tab.id, { type: "PREPARE", extract: stored });
      if (res?.extract) await rememberExtract(res.extract);
      sendResponse(res || { ok: false, error: "Prepare did not run on this page." });
      return;
    } else if (msg.type === "PAGE_EXTRACT") {
      await rememberExtract(msg.extract);
      sendResponse({ ok: true });
    } else if (msg.type === "LIST_JOBS") {
      try {
        const data = await api("/api/jobs?limit=25&new_only=true");
        sendResponse({ ok: true, jobs: jobsFromApi(data), backendUrl: (await cfg()).backendUrl });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err), jobs: [] });
      }
    } else if (msg.type === "TEST_CONNECTION") {
      sendResponse(await testConnection());
    } else if (msg.type === "GET_STATE") {
      const c = await cfg();
      const local = await chrome.storage.local.get({ scanStatus: null, pageExtract: null });
      sendResponse({
        ...c,
        hasToken: Boolean(c.token),
        scanStatus: local.scanStatus || null,
        pageExtract: local.pageExtract || null,
      });
    }
  })();
  return true;
});

migrateLocalhostIfUnreachable();
scheduleScanAlarm();
connect();
