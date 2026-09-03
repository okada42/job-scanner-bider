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
      await fillWindow();
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

let filling = false;
let fillAgain = false;
const finishing = new Set();
const closingByUs = new Set();

async function readMaxActive() {
  try {
    const data = await api("/api/settings");
    const n = Number(data?.bider?.max_active_jobs);
    return Math.max(1, Math.min(10, Number.isFinite(n) ? n : 1));
  } catch (_) {
    return 1;
  }
}

async function getSlots() {
  const local = await chrome.storage.local.get({ activeSlots: [] });
  return Array.isArray(local.activeSlots) ? local.activeSlots : [];
}

async function setSlots(slots) {
  await chrome.storage.local.set({ activeSlots: slots });
  await chrome.storage.sync.set({ currentJob: slots[0] || null });
}

async function getParked() {
  const local = await chrome.storage.local.get({ parkedSlots: [] });
  return Array.isArray(local.parkedSlots) ? local.parkedSlots : [];
}

async function setParked(slots) {
  await chrome.storage.local.set({ parkedSlots: slots.slice(0, 40) });
}

async function parkSlot(slot, reason) {
  if (!slot?.id) return;
  const parked = await getParked();
  const next = [{ ...slot, tabId: null, parkedReason: reason || "closed" }, ...parked.filter((s) => s.id !== slot.id)];
  await setParked(next);
}

async function getDrafts() {
  const local = await chrome.storage.local.get({ drafts: {} });
  return local.drafts && typeof local.drafts === "object" ? local.drafts : {};
}

async function setDraft(jobId, extract) {
  if (!jobId || !extract) return;
  const drafts = await getDrafts();
  drafts[jobId] = extract;
  await chrome.storage.local.set({
    drafts,
    pageExtract: extract,
    applyDraft: extract,
  });
}

async function draftFor(jobId, tabId) {
  const drafts = await getDrafts();
  if (jobId && drafts[jobId]) return drafts[jobId];
  const slots = await getSlots();
  const parked = await getParked();
  const slot =
    (tabId && slots.find((s) => s.tabId === tabId)) ||
    (jobId && slots.find((s) => s.id === jobId)) ||
    (jobId && parked.find((s) => s.id === jobId));
  return slot?.extract || drafts[slot?.id] || null;
}

function previewFromJob(job, extra = {}) {
  return {
    client: extra.client || job.client || "—",
    url: job.url,
    title: extra.title || job.title || "",
    details: extra.details || extra.description || "",
    description: extra.details || extra.description || "",
    identity: extra.identity ?? null,
    ruleCheck: extra.ruleCheck ?? null,
    achievement: extra.achievement || "—",
    completionRate: extra.completionRate || "—",
    postedLabel: extra.postedLabel || "",
    postedAt: extra.postedAt || null,
    dueAt: extra.dueAt || null,
    loading: Boolean(extra.loading),
    fetchError: Boolean(extra.fetchError),
    at: extra.at || new Date().toISOString(),
  };
}

async function fetchJobPreview(job) {
  const base = previewFromJob(job);
  if (!job?.url || !/crowdworks\.jp/i.test(job.url)) return base;
  try {
    const res = await fetch(job.url, { credentials: "include", redirect: "follow" });
    if (!res.ok) return { ...base, fetchError: true };
    const html = await res.text();
    const parsed = typeof self.parseCrowdWorksDetail === "function" ? self.parseCrowdWorksDetail(html) : null;
    if (!parsed) return { ...base, fetchError: true };
    return previewFromJob(job, parsed);
  } catch (_) {
    return { ...base, fetchError: true };
  }
}

async function claimJobs(need) {
  if (need <= 0) return [];
  try {
    const data = await api(`/api/jobs/next-batch?count=${need}`);
    if (Array.isArray(data?.jobs)) return data.jobs;
  } catch (_) {
    /* older API */
  }
  const out = [];
  for (let i = 0; i < need; i += 1) {
    const data = await api("/api/jobs/next");
    if (!data.job) break;
    out.push(data.job);
  }
  return out;
}

async function openPreparedTab(job, extract, focus) {
  const tab = await chrome.tabs.create({ url: job.url, active: Boolean(focus) });
  await api(`/api/jobs/${job.id}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "PROCESSING" }),
  });
  if (tab?.id) await runApplyFlow(tab.id, extract, job.id);
  return tab?.id || null;
}

async function fillWindow() {
  const c = await cfg();
  if (!c.applyEnabled) {
    return { ok: false, error: "Enable apply (Bider) in the popup first." };
  }
  if (c.paused) {
    return { ok: false, error: "Bider is paused. Click Resume in the popup." };
  }
  if (filling) {
    fillAgain = true;
    return { ok: true, busy: true, slots: await getSlots() };
  }
  filling = true;
  try {
    const maxActive = await readMaxActive();
    let slots = await getSlots();
    const have = new Set(slots.map((s) => s.id));
    const need = maxActive - slots.length;
    if (need > 0) {
      const jobs = await claimJobs(need);
      for (let i = 0; i < jobs.length; i += 1) {
        const job = jobs[i];
        if (!job?.id || have.has(job.id)) continue;
        const extract = await fetchJobPreview(job);
        const tabId = await openPreparedTab(job, extract, slots.length === 0);
        const slot = {
          id: job.id,
          url: job.url,
          title: job.title,
          client: extract.client || job.client,
          budget: job.budget,
          tabId,
          opened: true,
          extract,
        };
        slots = [...slots, slot];
        have.add(job.id);
        await setDraft(job.id, extract);
        await setSlots(slots);
      }
    }
    return { ok: true, slots, maxActive };
  } finally {
    filling = false;
    if (fillAgain) {
      fillAgain = false;
      fillWindow();
    }
  }
}

async function openSlot(jobId) {
  const slots = await getSlots();
  const parked = await getParked();
  const fromParked = parked.find((s) => s.id === jobId);
  const slot = (jobId && slots.find((s) => s.id === jobId)) || fromParked || slots[0];
  if (!slot) return fillWindow();
  const extract = slot.extract || (await fetchJobPreview(slot));
  await setDraft(slot.id, extract);
  if (slot.tabId) {
    try {
      await chrome.tabs.update(slot.tabId, { active: true });
      await runApplyFlow(slot.tabId, extract, slot.id);
      return { ok: true, job: slot };
    } catch (_) {
      /* tab gone */
    }
  }
  const tabId = await openPreparedTab(slot, extract, true);
  const updated = { ...slot, tabId, opened: true, extract };
  if (fromParked) {
    await setParked(parked.filter((s) => s.id !== slot.id));
    const have = slots.some((s) => s.id === slot.id);
    await setSlots(have ? slots.map((s) => (s.id === slot.id ? updated : s)) : [...slots, updated]);
  } else {
    await setSlots(slots.map((s) => (s.id === slot.id ? updated : s)));
  }
  return { ok: true, job: updated };
}

async function finishSlot(jobId, status, opts = {}) {
  const park = Boolean(opts.park);
  const closeTab = opts.closeTab !== false;
  if (!jobId || finishing.has(jobId)) return { ok: true };
  finishing.add(jobId);
  try {
    const slots = await getSlots();
    const slot = slots.find((s) => s.id === jobId);
    try {
      await api(`/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    } catch (_) {
      /* already closed on the server */
    }
    if (park && slot) await parkSlot(slot, status === "SKIPPED" ? "skipped" : "closed");
    if (closeTab && slot?.tabId) {
      closingByUs.add(slot.tabId);
      try {
        await chrome.tabs.remove(slot.tabId);
      } catch (_) {
        closingByUs.delete(slot.tabId);
      }
    }
    await setSlots(slots.filter((s) => s.id !== jobId));
    return fillWindow();
  } finally {
    finishing.delete(jobId);
  }
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

async function rememberExtract(extract, tabId, jobId) {
  if (!extract) return;
  const slots = await getSlots();
  const slot =
    (jobId && slots.find((s) => s.id === jobId)) ||
    (tabId && slots.find((s) => s.tabId === tabId)) ||
    slots.find((s) => s.url && extract.url && s.url === extract.url);
  if (slot) {
    const next = slots.map((s) =>
      s.id === slot.id
        ? {
            ...s,
            extract,
            client: extract.client || s.client,
            title: extract.title || s.title,
          }
        : s
    );
    await setSlots(next);
    await setDraft(slot.id, extract);
    return;
  }
  await chrome.storage.local.set({ pageExtract: extract, applyDraft: extract });
}

async function runApplyFlow(tabId, draft, jobId) {
  await waitTabComplete(tabId);
  let extract = draft || (await draftFor(jobId, tabId));
  let first = await sendToTab(tabId, { type: "AUTO_APPLY", extract });
  if (first?.extract) {
    extract = first.extract;
    await rememberExtract(extract, tabId, jobId);
  }
  if (first?.stage === "clicked_apply") {
    await waitTabComplete(tabId);
    const second = await sendToTab(tabId, { type: "AUTO_APPLY", extract });
    if (second?.extract) await rememberExtract(second.extract, tabId, jobId);
    return second;
  }
  return first;
}

async function setApplyEnabled(enabled) {
  const patch = { applyEnabled: Boolean(enabled), running: Boolean(enabled) };
  if (enabled) patch.paused = false;
  await chrome.storage.sync.set(patch);
  if (enabled) {
    await connect();
    return fillWindow();
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
      sendResponse(await fillWindow());
    } else if (msg.type === "SKIP") {
      try {
        const slots = await getSlots();
        const id = msg.jobId || slots[0]?.id;
        sendResponse(id ? await finishSlot(id, "SKIPPED", { park: true, closeTab: true }) : await fillWindow());
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    } else if (msg.type === "NEXT") {
      try {
        sendResponse(await fillWindow());
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    } else if (msg.type === "OPEN_JOB" || msg.type === "REOPEN_JOB") {
      try {
        sendResponse(await openSlot(msg.jobId));
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    } else if (msg.type === "APPLY_FINISHED") {
      try {
        const slots = await getSlots();
        const tabId = _sender.tab?.id;
        const slot =
          slots.find((s) => s.tabId === tabId) ||
          (msg.jobId && slots.find((s) => s.id === msg.jobId)) ||
          slots[0];
        sendResponse(slot ? await finishSlot(slot.id, "COMPLETED", { park: false, closeTab: false }) : { ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    } else if (msg.type === "PREPARE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      const slots = await getSlots();
      const slot = slots.find((s) => s.tabId === tab.id);
      const stored = await draftFor(slot?.id, tab.id);
      const res = await sendToTab(tab.id, { type: "PREPARE", extract: stored });
      if (res?.extract) await rememberExtract(res.extract, tab.id, slot?.id);
      sendResponse(res || { ok: false, error: "Prepare did not run on this page." });
      return;
    } else if (msg.type === "PAGE_EXTRACT") {
      await rememberExtract(msg.extract, _sender.tab?.id);
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
      const local = await chrome.storage.local.get({
        scanStatus: null,
        pageExtract: null,
        applyDraft: null,
        activeSlots: [],
        parkedSlots: [],
      });
      const slots = Array.isArray(local.activeSlots) ? local.activeSlots : [];
      const parked = Array.isArray(local.parkedSlots) ? local.parkedSlots : [];
      sendResponse({
        ...c,
        currentJob: slots[0] || c.currentJob,
        activeSlots: slots,
        parkedSlots: parked,
        hasToken: Boolean(c.token),
        scanStatus: local.scanStatus || null,
        pageExtract: local.pageExtract || local.applyDraft || slots[0]?.extract || null,
        applyDraft: local.applyDraft || slots[0]?.extract || null,
      });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (closingByUs.has(tabId)) {
    closingByUs.delete(tabId);
    return;
  }
  getSlots().then((slots) => {
    const slot = slots.find((s) => s.tabId === tabId);
    if (slot) finishSlot(slot.id, "SKIPPED", { park: true, closeTab: false });
  });
});

migrateLocalhostIfUnreachable();
scheduleScanAlarm();
connect();
