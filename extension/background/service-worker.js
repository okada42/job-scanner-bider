const DEFAULTS = {
  backendUrl: "http://127.0.0.1:8000",
  token: "",
  running: false,
  paused: false,
  currentJob: null,
};

async function cfg() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

let ws = null;

async function connect() {
  const c = await cfg();
  if (!c.token || !c.backendUrl) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = c.backendUrl.replace(/^http/, "ws") + "/ws/bider?token=" + encodeURIComponent(c.token);
  ws = new WebSocket(url);
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.event === "NEW_JOB") {
      const settings = await cfg();
      if (!settings.running || settings.paused) return;
      await maybeOpen(msg.job);
    }
  };
  ws.onclose = () => {
    ws = null;
  };
}

async function api(path, options = {}) {
  const c = await cfg();
  const res = await fetch(c.backendUrl + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Token": c.token,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function maybeOpen(job) {
  const c = await cfg();
  if (!job) return;
  if (c.currentJob && c.currentJob.id !== job.id) return;
  await chrome.storage.sync.set({ currentJob: job });
  await chrome.tabs.create({ url: job.url, active: true });
  await api(`/api/jobs/${job.id}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "PROCESSING" }),
  });
}

async function claimAndOpen() {
  const c = await cfg();
  if (!c.running || c.paused) return;
  const data = await api("/api/jobs/next");
  if (data.job) await maybeOpen(data.job);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create("bider-keepalive", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bider-keepalive") connect();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "START") {
      await chrome.storage.sync.set({ running: true, paused: false });
      await connect();
      await claimAndOpen();
      sendResponse({ ok: true });
    } else if (msg.type === "PAUSE") {
      await chrome.storage.sync.set({ paused: true });
      sendResponse({ ok: true });
    } else if (msg.type === "RESUME") {
      await chrome.storage.sync.set({ paused: false, running: true });
      await connect();
      sendResponse({ ok: true });
    } else if (msg.type === "SKIP" || msg.type === "NEXT") {
      const c = await cfg();
      if (c.currentJob) {
        await api(`/api/jobs/${c.currentJob.id}/status`, {
          method: "POST",
          body: JSON.stringify({ status: msg.type === "SKIP" ? "SKIPPED" : "COMPLETED" }),
        });
      }
      await chrome.storage.sync.set({ currentJob: null });
      await claimAndOpen();
      sendResponse({ ok: true });
    } else if (msg.type === "PREPARE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ ok: false });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "PREPARE" }, sendResponse);
      return;
    } else if (msg.type === "GET_STATE") {
      sendResponse(await cfg());
    }
  })();
  return true;
});

connect();
