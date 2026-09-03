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
  document.getElementById("applyEnabled").checked = Boolean(c.applyEnabled || c.running);
});

document.getElementById("useProd").onclick = () => {
  document.getElementById("backendUrl").value = PRODUCTION_API;
};

document.getElementById("save").onclick = async () => {
  const scanEnabled = document.getElementById("scanEnabled").checked;
  const applyEnabled = document.getElementById("applyEnabled").checked;
  const backendUrl = normalizeBackendUrl(document.getElementById("backendUrl").value);
  const token = document.getElementById("token").value.trim();
  document.getElementById("backendUrl").value = backendUrl;
  await chrome.storage.sync.set({
    backendUrl,
    token,
    scanEnabled,
    applyEnabled,
    running: applyEnabled,
  });
  await chrome.runtime.sendMessage({ type: "CONFIG_CHANGED" });
  setStatus(token ? `Saved. API: ${backendUrl}` : "Saved, but the token is still empty.", token ? "ok" : "err");
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
