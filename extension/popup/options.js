const DEFAULTS = {
  backendUrl: "http://127.0.0.1:8000",
  token: "",
  scanEnabled: false,
  applyEnabled: false,
  running: false,
};

chrome.storage.sync.get(DEFAULTS, (c) => {
  document.getElementById("backendUrl").value = c.backendUrl;
  document.getElementById("token").value = c.token;
  document.getElementById("scanEnabled").checked = Boolean(c.scanEnabled);
  document.getElementById("applyEnabled").checked = Boolean(c.applyEnabled || c.running);
});

document.getElementById("save").onclick = async () => {
  const scanEnabled = document.getElementById("scanEnabled").checked;
  const applyEnabled = document.getElementById("applyEnabled").checked;
  await chrome.storage.sync.set({
    backendUrl: document.getElementById("backendUrl").value.trim(),
    token: document.getElementById("token").value.trim(),
    scanEnabled,
    applyEnabled,
    running: applyEnabled,
  });
  await chrome.runtime.sendMessage({ type: "CONFIG_CHANGED" });
};
