const DEFAULTS = {
  backendUrl: PRODUCTION_API,
  token: "",
  scanEnabled: false,
  applyEnabled: false,
  running: false,
};

function setStatus(text, kind) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = kind || "";
}

chrome.storage.sync.get(DEFAULTS, (c) => {
  document.getElementById("backendUrl").value = normalizeBackendUrl(c.backendUrl);
  document.getElementById("token").value = c.token;
  document.getElementById("scanEnabled").checked = Boolean(c.scanEnabled);
  document.getElementById("applyEnabled").checked = Boolean(c.applyEnabled);
});

// The name is per Chrome profile, so it lives in storage.local (not sync).
chrome.storage.local.get({ actorName: "" }, (local) => {
  document.getElementById("actorName").value = local.actorName || "";
});

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().replace(/さん$/, "").slice(0, 40);
}

document.getElementById("useProd").onclick = () => {
  document.getElementById("backendUrl").value = PRODUCTION_API;
};

document.getElementById("save").onclick = async () => {
  const scanEnabled = document.getElementById("scanEnabled").checked;
  const applyEnabled = document.getElementById("applyEnabled").checked;
  const backendUrl = normalizeBackendUrl(document.getElementById("backendUrl").value);
  const token = document.getElementById("token").value.trim();
  const actorName = cleanName(document.getElementById("actorName").value);
  document.getElementById("backendUrl").value = backendUrl;
  document.getElementById("actorName").value = actorName;
  const bider = applyEnabled && Boolean(actorName);
  document.getElementById("applyEnabled").checked = bider;
  await chrome.storage.local.set({ actorName });
  await chrome.storage.sync.set({
    backendUrl,
    token,
    scanEnabled,
    applyEnabled: bider,
    running: bider,
  });
  await chrome.runtime.sendMessage({ type: "SET_ACTOR", name: actorName });
  await chrome.runtime.sendMessage({ type: "CONFIG_CHANGED" });
  if (!token) {
    setStatus("Saved, but the token is still empty.", "err");
  } else if (applyEnabled && !actorName) {
    setStatus("Saved. Job Bider stays off until you enter your name.", "err");
  } else {
    setStatus(`Saved. API: ${backendUrl}${actorName ? ` · Name: ${actorName}` : ""}`, "ok");
  }
};

document.getElementById("test").onclick = async () => {
  await document.getElementById("save").onclick();
  setStatus("Testing…");
  const res = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
  if (res?.ok) {
    setStatus(`Connected to ${res.backendUrl}. Token accepted.`, "ok");
    return;
  }
  setStatus(res?.error || "Connection failed.", "err");
};
