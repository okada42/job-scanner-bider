async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  document.getElementById("scanEnabled").checked = Boolean(state.scanEnabled);
  document.getElementById("applyEnabled").checked = Boolean(state.applyEnabled);
  const el = document.getElementById("status");
  const job = state.currentJob;
  el.textContent = !state.applyEnabled
    ? "Apply stopped"
    : state.paused
      ? "Paused"
      : job
        ? job.title || job.url
        : "Idle / waiting";
  const scanEl = document.getElementById("scanStatus");
  if (!state.scanEnabled) {
    scanEl.textContent = "Scan off";
  } else if (state.scanStatus?.error) {
    scanEl.textContent = `Scan error: ${state.scanStatus.error}`;
  } else if (state.scanStatus) {
    scanEl.textContent = `Last scan: ${state.scanStatus.found ?? 0} found, ${state.scanStatus.created ?? 0} new`;
  } else {
    scanEl.textContent = "Scan on";
  }
}

document.getElementById("scanEnabled").onchange = (e) =>
  chrome.runtime.sendMessage({ type: "SET_SCAN", enabled: e.target.checked }).then(refresh);
document.getElementById("applyEnabled").onchange = (e) =>
  chrome.runtime.sendMessage({ type: "SET_APPLY", enabled: e.target.checked }).then(refresh);
document.getElementById("start").onclick = () => chrome.runtime.sendMessage({ type: "START" }).then(refresh);
document.getElementById("pause").onclick = () => chrome.runtime.sendMessage({ type: "PAUSE" }).then(refresh);
document.getElementById("resume").onclick = () => chrome.runtime.sendMessage({ type: "RESUME" }).then(refresh);
document.getElementById("skip").onclick = () => chrome.runtime.sendMessage({ type: "SKIP" }).then(refresh);
document.getElementById("next").onclick = () => chrome.runtime.sendMessage({ type: "NEXT" }).then(refresh);
document.getElementById("prepare").onclick = () => chrome.runtime.sendMessage({ type: "PREPARE_TAB" });
refresh();
