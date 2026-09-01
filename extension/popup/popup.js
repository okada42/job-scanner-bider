async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  const el = document.getElementById("status");
  const job = state.currentJob;
  el.textContent = !state.running
    ? "Stopped"
    : state.paused
      ? "Paused"
      : job
        ? job.title || job.url
        : "Idle / waiting";
}

document.getElementById("start").onclick = () => chrome.runtime.sendMessage({ type: "START" }).then(refresh);
document.getElementById("pause").onclick = () => chrome.runtime.sendMessage({ type: "PAUSE" }).then(refresh);
document.getElementById("resume").onclick = () => chrome.runtime.sendMessage({ type: "RESUME" }).then(refresh);
document.getElementById("skip").onclick = () => chrome.runtime.sendMessage({ type: "SKIP" }).then(refresh);
document.getElementById("next").onclick = () => chrome.runtime.sendMessage({ type: "NEXT" }).then(refresh);
document.getElementById("prepare").onclick = () => chrome.runtime.sendMessage({ type: "PREPARE_TAB" });
refresh();
