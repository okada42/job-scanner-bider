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
const LANCERS_ALARM = "lancers-keepalive";
const LANCERS_KEEPALIVE_MIN = 20;
const LANCERS_KEEPALIVE_MS = LANCERS_KEEPALIVE_MIN * 60 * 1000;
const LANCERS_HOME = "https://www.lancers.jp/";
const LANCERS_TAB_URLS = ["https://www.lancers.jp/*", "https://lancers.jp/*"];
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

async function rememberProfileUser(name) {
  const value = String(name || "").replace(/\s+/g, " ").trim().replace(/さん$/, "");
  if (!value || value.length > 40 || /login|会員|ログイン/i.test(value)) return "";
  await chrome.storage.local.set({ profileUser: value });
  registerActor();
  return value;
}

async function getActor() {
  const local = await chrome.storage.local.get({ profileUser: "", profileKey: "" });
  if (local.profileUser) return local.profileUser;
  let key = local.profileKey;
  if (!key) {
    key = `ext-${Math.random().toString(36).slice(2, 10)}`;
    await chrome.storage.local.set({ profileKey: key });
  }
  return key;
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
  registerActor();
  ws.onmessage = async (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    const event = String(msg?.event || "").toUpperCase();
    if (event === "NEW_JOB" || event === "JOB_AVAILABLE") {
      await onJobAlert(msg.job);
    }
    if (event === "MANUAL_JOB") {
      await openManualJob(msg.job);
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
  const actor = await getActor();
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-Token": token,
        ...(actor ? { "X-Bider-Actor": actor } : {}),
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

async function pingBiderSocket() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ action: "PING" }));
  } catch (_) {
    /* socket died; next alarm reconnects */
  }
}

function isLancersJob(job) {
  const platform = String(job?.platform || "").toLowerCase();
  const url = String(job?.url || "");
  return platform === "lancers" || /lancers\.jp/i.test(url);
}

async function lancersIsLoggedOut() {
  const local = await chrome.storage.local.get({ lancersLoggedOut: false });
  return Boolean(local.lancersLoggedOut);
}

async function skipLancersOpen(job) {
  return isLancersJob(job) && (await lancersIsLoggedOut());
}

async function toastLancers(text) {
  try {
    const tabs = await chrome.tabs.query({ url: LANCERS_TAB_URLS });
    await Promise.all(
      tabs.map((tab) =>
        tab.id
          ? chrome.tabs.sendMessage(tab.id, { type: "SHOW_TOAST", text }).catch(() => {})
          : Promise.resolve()
      )
    );
  } catch (_) {
    /* no tab */
  }
  try {
    await chrome.notifications.create("lancers-login", {
      type: "basic",
      iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      title: "Job Bider",
      message: text,
    });
  } catch (_) {
    /* notifications optional */
  }
}

async function setLancersLoggedOut(loggedOut, { toast } = {}) {
  const prev = await lancersIsLoggedOut();
  await chrome.storage.local.set({
    lancersLoggedOut: Boolean(loggedOut),
    loginMissing: false,
  });
  if (loggedOut && toast && !prev) await toastLancers("Lancersにログインしてください");
}

async function markLancersActivity() {
  await chrome.storage.local.set({
    lancersLastActivity: Date.now(),
    lancersLoggedOut: false,
    loginMissing: false,
  });
}

function isLancersWorkUrl(url) {
  return /lancers\.jp/i.test(String(url || "")) && /\/work\/(detail|propose_start)\//.test(String(url || ""));
}

async function reloadLancersTab(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.reload(tabId);
    return true;
  } catch (_) {
    return false;
  }
}

async function keepLancersSession() {
  await chrome.storage.local.set({ lancersLastRefresh: Date.now() });
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: LANCERS_TAB_URLS });
  } catch (_) {
    tabs = [];
  }
  const idle = tabs.filter((tab) => tab.id && !isLancersWorkUrl(tab.url));
  if (idle.length) {
    for (const tab of idle) await reloadLancersTab(tab.id);
  } else {
    const stored = Number((await chrome.storage.local.get({ lancersKeepaliveTabId: 0 })).lancersKeepaliveTabId || 0);
    let keep = null;
    if (stored) {
      try {
        keep = await chrome.tabs.get(stored);
      } catch (_) {
        keep = null;
      }
    }
    if (keep?.id && /lancers\.jp/i.test(keep.url || "") && !isLancersWorkUrl(keep.url)) {
      await reloadLancersTab(keep.id);
    } else {
      try {
        const tab = await chrome.tabs.create({ url: LANCERS_HOME, active: false });
        if (tab?.id) await chrome.storage.local.set({ lancersKeepaliveTabId: tab.id });
      } catch (_) {
        /* fall through to fetch */
      }
    }
  }
  try {
    const res = await fetch(LANCERS_HOME, { credentials: "include", redirect: "follow" });
    const html = await res.text();
    if (typeof self.parseLancersLoggedOut === "function" && self.parseLancersLoggedOut(html)) {
      await setLancersLoggedOut(true, { toast: true });
    } else if (typeof self.parseLancersLoggedInUser === "function") {
      const name = self.parseLancersLoggedInUser(html);
      if (name) await rememberProfileUser(name);
    }
  } catch (_) {
    /* network */
  }
}

async function scheduleLancersAlarm() {
  try {
    const existing = await chrome.alarms.get(LANCERS_ALARM);
    if (existing && Number(existing.periodInMinutes) === LANCERS_KEEPALIVE_MIN) return;
  } catch (_) {
    /* recreate */
  }
  await chrome.alarms.create(LANCERS_ALARM, {
    delayInMinutes: LANCERS_KEEPALIVE_MIN,
    periodInMinutes: LANCERS_KEEPALIVE_MIN,
  });
}

async function ensureLancersRefresh() {
  await scheduleLancersAlarm();
  const local = await chrome.storage.local.get({ lancersLastRefresh: 0 });
  const last = Number(local.lancersLastRefresh || 0);
  if (!last) {
    await chrome.storage.local.set({ lancersLastRefresh: Date.now() });
    return;
  }
  if (Date.now() - last >= LANCERS_KEEPALIVE_MS) await keepLancersSession();
}

function clearStaleLoginHalt() {
  chrome.storage.local.set({ loginMissing: false });
}

async function onJobAlert(job) {
  const settings = await cfg();
  if (!settings.applyEnabled || settings.paused) return;
  if (await skipLancersOpen(job)) return;
  await fillWindow();
  return job;
}

async function topUpIfNeeded() {
  const settings = await cfg();
  if (!settings.applyEnabled || settings.paused) return { ok: true, skipped: true };
  const slots = await getSlots();
  const maxActive = await readMaxActive();
  const regular = slots.filter((s) => !s.manual).length;
  if (regular >= maxActive) return { ok: true, slots, maxActive };
  return fillWindow();
}

async function readMaxActive() {
  try {
    const data = await api("/api/settings");
    const n = Number(data?.bider?.max_active_jobs);
    return Math.max(1, Math.min(10, Number.isFinite(n) ? n : 1));
  } catch (_) {
    return 1;
  }
}

async function todayJst() {
  if (globalThis.JobBiderDates && JobBiderDates.todayJst) return JobBiderDates.todayJst();
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

async function ensureBiderScope() {
  const actor = await getActor();
  const day = await todayJst();
  const stamp = await chrome.storage.local.get({ biderActor: "", biderDay: "", activeSlots: [], parkedSlots: [] });
  if (stamp.biderActor === actor && stamp.biderDay === day) return { actor, day };
  const prevSlots = Array.isArray(stamp.activeSlots) ? stamp.activeSlots : [];
  const live = [];
  for (const slot of prevSlots) {
    if (await tabStillOpen(slot.tabId)) live.push({ ...slot, openedOnce: true });
  }
  const openedJobs = {};
  for (const slot of live) openedJobs[slot.id] = { extract: slot.extract, at: new Date().toISOString() };
  await chrome.storage.local.set({
    biderActor: actor,
    biderDay: day,
    activeSlots: live,
    parkedSlots: [],
    openedJobs,
  });
  await chrome.storage.sync.set({ currentJob: live[0] || null });
  return { actor, day };
}

async function getSlots() {
  await ensureBiderScope();
  const local = await chrome.storage.local.get({ activeSlots: [] });
  return Array.isArray(local.activeSlots) ? local.activeSlots : [];
}

async function getOpenedJobs() {
  await ensureBiderScope();
  const local = await chrome.storage.local.get({ openedJobs: {} });
  return local.openedJobs && typeof local.openedJobs === "object" ? local.openedJobs : {};
}

async function markOpened(job, extract) {
  if (!job?.id) return;
  const opened = await getOpenedJobs();
  opened[job.id] = {
    url: job.url,
    extract: extract || job.extract || null,
    at: new Date().toISOString(),
  };
  await chrome.storage.local.set({ openedJobs: opened });
}

async function setSlots(slots) {
  await chrome.storage.local.set({ activeSlots: slots });
  await chrome.storage.sync.set({ currentJob: slots[0] || null });
}

async function getParked() {
  await ensureBiderScope();
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
    dueAt: extra.dueAt || extra.deadline || null,
    budget: extra.budget || job.budget || "",
    deadline: extra.deadline || job.deadline || "",
    loading: Boolean(extra.loading),
    fetchError: Boolean(extra.fetchError),
    at: extra.at || new Date().toISOString(),
  };
}

async function fetchJobPreview(job) {
  const base = previewFromJob(job);
  const url = String(job?.url || "");
  const isCw = /crowdworks\.jp/i.test(url);
  const isLn = /lancers\.jp/i.test(url);
  if (!url || (!isCw && !isLn)) return base;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { credentials: "include", redirect: "follow", signal: ctrl.signal });
    if (!res.ok) return { ...base, fetchError: true };
    const html = await res.text();
    const parsed = isLn
      ? typeof self.parseLancersDetail === "function"
        ? self.parseLancersDetail(html)
        : null
      : typeof self.parseCrowdWorksDetail === "function"
        ? self.parseCrowdWorksDetail(html)
        : null;
    if (!parsed) return { ...base, fetchError: true };
    return previewFromJob(job, parsed);
  } catch (_) {
    return { ...base, fetchError: true };
  } finally {
    clearTimeout(timer);
  }
}

const IN_FLIGHT = new Set(["SENT_TO_BIDER", "PROCESSING", "PROPOSAL_PAGE_READY", "WAITING_FOR_USER"]);
const QUEUEABLE = new Set(["QUEUED", "NEW", "SENT_TO_BIDER"]);
const LISTABLE = new Set([
  "QUEUED",
  "NEW",
  "SENT_TO_BIDER",
  "PROCESSING",
  "PROPOSAL_PAGE_READY",
  "WAITING_FOR_USER",
  "SKIPPED",
  "COMPLETED",
]);

function jobStatus(job) {
  return String(job?.status || "").toUpperCase();
}

function isPlatformUser(name) {
  const value = String(name || "").replace(/\s+/g, " ").trim().replace(/さん$/, "");
  return Boolean(value) && value.length <= 40 && !/^ext-/i.test(value) && !/login|会員|ログイン/i.test(value);
}

async function registerActor() {
  const actor = await getActor();
  if (!isPlatformUser(actor)) return "";
  try {
    await api("/api/jobs/actor", { method: "POST", body: JSON.stringify({ actor }) });
  } catch (_) {
    /* older backends */
  }
  return actor;
}

let lastQueuedSync = 0;

async function syncQueuedClaims(jobs) {
  const actor = await registerActor();
  if (!actor) return;
  const now = Date.now();
  if (now - lastQueuedSync < 15000) return;
  const queued = (jobs || [])
    .filter((job) => {
      if (!job?.id) return false;
      const status = String(job.claim_status || job.status || "").toUpperCase();
      if (IN_FLIGHT.has(status) || status === "SKIPPED" || status === "CLOSED" || status === "FAILED") return false;
      return true;
    })
    .slice(0, 40);
  if (!queued.length) return;
  lastQueuedSync = now;
  try {
    await api("/api/jobs/claims", {
      method: "POST",
      body: JSON.stringify({
        actor,
        claims: queued.map((job) => ({ job_id: job.id, status: "QUEUED", url: job.url || null })),
      }),
    });
  } catch (_) {
    /* older backends */
  }
}

function addJobs(target, rows, seen) {
  for (const job of rows || []) {
    if (!job?.id || seen.has(job.id)) continue;
    seen.add(job.id);
    target.push(job);
  }
}

async function listBiderJobs() {
  const jobs = [];
  const seen = new Set();
  const [pending, snap] = await Promise.all([
    api("/api/jobs/pending").catch(() => []),
    api("/api/jobs/bider").catch(() => ({})),
  ]);
  addJobs(jobs, Array.isArray(pending) ? pending : [], seen);
  addJobs(jobs, snap?.active, seen);
  addJobs(jobs, snap?.queued, seen);
  addJobs(jobs, snap?.skipped, seen);
  if (snap?.current) addJobs(jobs, [snap.current], seen);
  if (jobs.length) return jobs.filter((job) => LISTABLE.has(jobStatus(job)) || job.claim_status || !job.status);
  try {
    addJobs(jobs, jobsFromApi(await api("/api/jobs?limit=40&new_only=true")), seen);
  } catch (_) {
    /* ignore */
  }
  return jobs.filter((job) => LISTABLE.has(jobStatus(job)) || !job.status);
}

async function markProcessing(job) {
  try {
    await api(`/api/jobs/${encodeURIComponent(job.id)}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "PROCESSING" }),
    });
  } catch (_) {
    /* already claimed or offline */
  }
  return { ...job, status: "PROCESSING" };
}

async function claimJobs(need, excludeIds) {
  if (need <= 0) return [];
  const skip = excludeIds || new Set();
  let claimed = [];
  try {
    const data = await api(`/api/jobs/next-batch?count=${need}&limit=${need}&force=true`);
    if (Array.isArray(data?.jobs)) claimed = data.jobs;
  } catch (_) {
    /* older API */
  }
  if (!claimed.length) {
    try {
      const data = await api(`/api/jobs/next-batch?count=${need}`);
      if (Array.isArray(data?.jobs)) claimed = data.jobs;
    } catch (_) {
      /* older API */
    }
  }
  if (!claimed.length) {
    for (let i = 0; i < need; i += 1) {
      try {
        const data = await api("/api/jobs/next");
        if (!data.job) break;
        claimed.push(data.job);
      } catch (_) {
        break;
      }
    }
  }
  claimed = claimed.filter((job) => job?.id && !skip.has(job.id));
  if (await lancersIsLoggedOut()) claimed = claimed.filter((job) => !isLancersJob(job));
  if (claimed.length >= need) return claimed.slice(0, need);

  const listed = await listBiderJobs();
  const inflight = listed.filter((job) => IN_FLIGHT.has(jobStatus(job)) && !skip.has(job.id));
  const queued = listed.filter((job) => QUEUEABLE.has(jobStatus(job)) && !skip.has(job.id) && !IN_FLIGHT.has(jobStatus(job)));
  const extras = [];
  const lancersOut = await lancersIsLoggedOut();
  for (const job of [...inflight, ...queued]) {
    if (lancersOut && isLancersJob(job)) continue;
    if (claimed.length + extras.length >= need) break;
    if (claimed.some((row) => row.id === job.id) || extras.some((row) => row.id === job.id)) continue;
    extras.push(IN_FLIGHT.has(jobStatus(job)) ? job : await markProcessing(job));
  }
  return [...claimed, ...extras].slice(0, need);
}

async function tabStillOpen(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (_) {
    return false;
  }
}

async function reviveSlots(slots) {
  const next = [];
  for (const slot of slots) {
    if (await tabStillOpen(slot.tabId)) {
      next.push(slot);
      continue;
    }
    const extract = slot.extract || (await fetchJobPreview(slot));
    if (await skipLancersOpen(slot)) {
      next.push({ ...slot, tabId: null, extract });
      continue;
    }
    const tabId = await openPreparedTab(slot, extract, next.length === 0);
    const updated = { ...slot, tabId, opened: true, extract };
    next.push(updated);
    await setDraft(slot.id, extract);
  }
  await setSlots(next);
  return next;
}

async function openPreparedTab(job, extract, focus) {
  if (await skipLancersOpen(job)) return null;
  if (isLancersJob(job)) await markLancersActivity();
  const tab = await chrome.tabs.create({ url: job.url, active: Boolean(focus) });
  await markProcessing(job);
  await markOpened(job, extract);
  if (tab?.id) await runApplyFlow(tab.id, extract, job.id);
  return tab?.id || null;
}

function slotFromJob(job, extract, tabId) {
  return {
    id: job.id,
    url: job.url,
    title: job.title,
    client: extract.client || job.client,
    budget: job.budget,
    deadline: job.deadline,
    posted_at: extract.postedLabel || job.posted_at || job.detected_at,
    tabId,
    opened: true,
    openedOnce: true,
    extract,
    status: job.status || "PROCESSING",
    claim_status: "PROCESSING",
    manual: Boolean(job.manual || Number(job.priority || 0) >= 100),
    priority: Number(job.priority || 0),
    hourly: job.hourly,
  };
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
      registerActor();
      const maxActive = await readMaxActive();
    let slots = await reviveSlots(await getSlots());
    const have = new Set(slots.map((s) => s.id));
    const regular = slots.filter((s) => !s.manual).length;
    const need = maxActive - regular;
    if (need > 0) {
      const jobs = await claimJobs(need, have);
      for (let i = 0; i < jobs.length; i += 1) {
        const job = jobs[i];
        if (!job?.id || have.has(job.id) || !job.url) continue;
        if (await skipLancersOpen(job)) continue;
        const extract = await fetchJobPreview(job);
        const tabId = await openPreparedTab(job, extract, slots.length === 0);
        if (!tabId) continue;
        const slot = slotFromJob(job, extract, tabId);
        slots = [...slots, slot];
        have.add(job.id);
        await setDraft(job.id, extract);
        await setSlots(slots);
      }
    }
    if (!slots.length) {
      return {
        ok: false,
        error: "No queued URLs to open. Check the queue and Max active on the dashboard.",
        slots,
        maxActive,
      };
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
  const slot = (jobId && slots.find((s) => s.id === jobId)) || fromParked || (!jobId && slots[0]) || null;
  if (!slot) {
    if (!jobId) return fillWindow();
    return openQueuedJob(jobId);
  }
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
  if (!tabId) {
    if (await skipLancersOpen(slot)) return { ok: false, error: "Lancersにログインしてください" };
    return { ok: false, error: "Could not open that job tab." };
  }
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

async function focusTab(tabId) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId) {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (_) {
        /* window focus is best-effort */
      }
    }
    await chrome.tabs.update(tabId, { active: true });
    return true;
  } catch (_) {
    return false;
  }
}

async function focusJob(jobId) {
  const slots = await getSlots();
  const parked = await getParked();
  const slot =
    (jobId && slots.find((s) => s.id === jobId)) ||
    (jobId && parked.find((s) => s.id === jobId)) ||
    (!jobId && slots[0]) ||
    null;
  if (slot?.tabId && (await focusTab(slot.tabId))) {
    return { ok: true, job: slot, focused: true };
  }
  const opened = await openSlot(jobId);
  if (opened?.job?.tabId) await focusTab(opened.job.tabId);
  return opened;
}

async function openManualJob(job) {
  const settings = await cfg();
  if (!job?.id || !job.url) return { ok: false };
  if (!settings.applyEnabled || settings.paused) return { ok: true, queued: true };
  if (await skipLancersOpen(job)) {
    await setLancersLoggedOut(true, { toast: true });
    return { ok: false, error: "Lancersにログインしてください" };
  }
  const slots = await getSlots();
  const existing = slots.find((s) => s.id === job.id);
  if (existing?.tabId) {
    await focusTab(existing.tabId);
    return { ok: true, job: existing };
  }
  const extract = await fetchJobPreview(job);
  const marked = { ...job, manual: true, priority: Number(job.priority || 100) };
  const tabId = await openPreparedTab(marked, extract, true);
  const slot = slotFromJob(marked, extract, tabId);
  const parked = await getParked();
  await setParked(parked.filter((s) => s.id !== job.id));
  const have = slots.some((s) => s.id === job.id);
  await setSlots(have ? slots.map((s) => (s.id === job.id ? slot : s)) : [...slots, slot]);
  await setDraft(job.id, extract);
  return { ok: true, job: slot };
}

async function openQueuedJob(jobId) {
  const listed = await listBiderJobs();
  const job = listed.find((row) => row.id === jobId);
  if (!job?.url) return { ok: false, error: "That job is not in the queue." };
  if (await skipLancersOpen(job)) {
    await setLancersLoggedOut(true, { toast: true });
    return { ok: false, error: "Lancersにログインしてください" };
  }
  const extract = await fetchJobPreview(job);
  const tabId = await openPreparedTab(job, extract, true);
  const slot = slotFromJob(job, extract, tabId);
  const slots = await getSlots();
  const parked = await getParked();
  await setParked(parked.filter((s) => s.id !== job.id));
  const have = slots.some((s) => s.id === job.id);
  await setSlots(have ? slots.map((s) => (s.id === job.id ? slot : s)) : [...slots, slot]);
  await setDraft(job.id, extract);
  return { ok: true, job: slot };
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
    if (park && slot) await parkSlot(slot, opts.reason || (status === "SKIPPED" ? "skipped" : "closed"));
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
  if (first?.error === "not_logged_in") {
    await setLancersLoggedOut(true, { toast: false });
    return first;
  }
  if (first?.extract) {
    extract = first.extract;
    await rememberExtract(extract, tabId, jobId);
  }
  if (first?.stage === "clicked_apply") {
    await waitTabComplete(tabId);
    const second = await sendToTab(tabId, { type: "AUTO_APPLY", extract });
    if (second?.error === "not_logged_in") {
      await setLancersLoggedOut(true, { toast: false });
      return second;
    }
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
      if (source.platform === "lancers" && (await lancersIsLoggedOut())) continue;
      try {
        const res = await fetch(source.url, { credentials: "include", redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${source.platform}`);
        const html = await res.text();
        if (source.platform === "lancers") {
          const lancersUser =
            typeof self.parseLancersLoggedInUser === "function" ? self.parseLancersLoggedInUser(html) : "";
          if (lancersUser) await rememberProfileUser(lancersUser);
          const loggedOut =
            typeof self.parseLancersLoggedOut === "function" ? self.parseLancersLoggedOut(html) : false;
          if (loggedOut) {
            await setLancersLoggedOut(true, { toast: true });
            lastRuns[source.id] = Date.now();
            continue;
          }
          await markLancersActivity();
        } else {
          const user = typeof self.parseLoggedInUser === "function" ? self.parseLoggedInUser(html) : "";
          if (user) await rememberProfileUser(user);
        }
        const jobs = parseListingJobs(html, source.platform);
        const actor = await getActor();
        const result = await api("/api/jobs/ingest", {
          method: "POST",
          body: JSON.stringify({ source_id: source.id, jobs, actor }),
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
  chrome.alarms.create(BIDER_ALARM, { periodInMinutes: CHROME_ALARM_FLOOR_MIN });
  scheduleLancersAlarm();
  clearStaleLoginHalt();
  migrateLocalhostIfUnreachable();
  scheduleScanAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  migrateLocalhostIfUnreachable();
  scheduleScanAlarm();
  chrome.alarms.create(BIDER_ALARM, { periodInMinutes: CHROME_ALARM_FLOOR_MIN });
  scheduleLancersAlarm();
  clearStaleLoginHalt();
  connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BIDER_ALARM) {
    pingBiderSocket();
    connect();
    topUpIfNeeded();
    ensureLancersRefresh();
  }
  if (alarm.name === SCAN_ALARM) runListingScan();
  if (alarm.name === LANCERS_ALARM) keepLancersSession();
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
    } else if (msg.type === "FOCUS_JOB") {
      try {
        sendResponse(await focusJob(msg.jobId));
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
        sendResponse(slot ? await finishSlot(slot.id, "COMPLETED", { park: true, closeTab: false, reason: "sent" }) : { ok: true });
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
      if (isLancersWorkUrl(_sender.tab?.url) || isLancersJob({ url: msg.extract?.url })) {
        await markLancersActivity();
      }
      sendResponse({ ok: true });
    } else if (msg.type === "LOGIN_MISSING") {
      sendResponse({ ok: true });
    } else if (msg.type === "LANCERS_LOGGED_OUT") {
      await setLancersLoggedOut(true, { toast: false });
      sendResponse({ ok: true });
    } else if (msg.type === "LANCERS_ACTIVITY") {
      await markLancersActivity();
      sendResponse({ ok: true });
    } else if (msg.type === "PROFILE_USER") {
      await rememberProfileUser(msg.name);
      if (String(msg.platform || "").toLowerCase() === "lancers") await markLancersActivity();
      sendResponse({ ok: true });
    } else if (msg.type === "LIST_JOBS") {
      try {
        const jobs = await listBiderJobs();
        syncQueuedClaims(jobs);
        const drafts = await getDrafts();
        const slots = await getSlots();
        const parked = await getParked();
        const extras = new Map();
        for (const slot of [...slots, ...parked]) extras.set(slot.id, slot.extract || null);
        const opened = await getOpenedJobs();
        sendResponse({
          ok: true,
          jobs: jobs.map((job) => {
            const openedRow = opened[job.id];
            return {
              ...job,
              openedOnce: Boolean(openedRow),
              extract: drafts[job.id] || extras.get(job.id) || openedRow?.extract || job.extract || null,
            };
          }),
          backendUrl: (await cfg()).backendUrl,
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err), jobs: [] });
      }
    } else if (msg.type === "TEST_CONNECTION") {
      sendResponse(await testConnection());
    } else if (msg.type === "GET_STATE") {
      const c = await cfg();
      await ensureBiderScope();
      const local = await chrome.storage.local.get({
        scanStatus: null,
        pageExtract: null,
        applyDraft: null,
        activeSlots: [],
        parkedSlots: [],
        profileUser: "",
        profileKey: "",
        biderDay: "",
        lancersLoggedOut: false,
        lancersLastRefresh: 0,
      });
      const slots = Array.isArray(local.activeSlots) ? local.activeSlots : [];
      const parked = Array.isArray(local.parkedSlots) ? local.parkedSlots : [];
      let focusedTabId = null;
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        focusedTabId = tab?.id || null;
      } catch (_) {
        /* ignore */
      }
      sendResponse({
        ...c,
        currentJob: slots[0] || c.currentJob,
        activeSlots: slots,
        parkedSlots: parked,
        hasToken: Boolean(c.token),
        profileUser: local.profileUser || "",
        profileKey: local.profileKey || "",
        biderDay: local.biderDay || "",
        focusedTabId,
        lancersLoggedOut: Boolean(local.lancersLoggedOut),
        lancersLastRefresh: Number(local.lancersLastRefresh || 0),
        scanStatus: local.scanStatus || null,
        pageExtract: local.pageExtract || local.applyDraft || slots[0]?.extract || null,
        applyDraft: local.applyDraft || slots[0]?.extract || null,
      });
    }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = String(info.url || tab?.url || "");
  if (!url || (!info.url && info.status !== "complete")) return;
  if (!/crowdworks\.jp\/proposals\/\d+/i.test(url)) return;
  getSlots().then((slots) => {
    const slot = slots.find((s) => s.tabId === tabId);
    if (slot) finishSlot(slot.id, "COMPLETED", { park: true, closeTab: false, reason: "sent" });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (closingByUs.has(tabId)) {
    closingByUs.delete(tabId);
    return;
  }
  getSlots().then((slots) => {
    const slot = slots.find((s) => s.tabId === tabId);
    if (slot) finishSlot(slot.id, "SKIPPED", { park: true, closeTab: false, reason: "closed" });
  });
});

migrateLocalhostIfUnreachable();
scheduleScanAlarm();
scheduleLancersAlarm();
clearStaleLoginHalt();
chrome.alarms.create(BIDER_ALARM, { periodInMinutes: CHROME_ALARM_FLOOR_MIN });
connect();
