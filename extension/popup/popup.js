function esc(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function safeUrl(url) {
  const raw = String(url || "");
  if (raw.startsWith("https://") || raw.startsWith("http://")) return raw;
  return "";
}

function slotLine(slot, parked) {
  const extract = slot.extract || {};
  const marks = JobBiderVerify.clientMarks(extract);
  const action = parked
    ? `<button type="button" data-reopen="${esc(slot.id)}">Reopen</button>`
    : `<button type="button" data-open="${esc(slot.id)}">Open</button>`;
  return `<div class="job"><div class="meta">${esc(slot.url || "")}</div><div>${esc(
    extract.client || slot.client || "—"
  )} · ${esc(slot.budget || "—")}</div><div class="meta">${esc(marks.identity)} · ${esc(marks.rule)}${
    parked ? " · skipped/closed" : ""
  }</div>${action}</div>`;
}

function jobLine(job) {
  const title = esc(job.title || job.external_job_id || "Untitled");
  const bits = [job.status, job.platform, job.client, job.budget].filter(Boolean).map(esc);
  return `<div class="job"><div>${title}</div><div class="meta">${bits.join(" · ")}</div></div>`;
}

async function refresh() {
  let state;
  try {
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  } catch (err) {
    document.getElementById("status").textContent = String(err && err.message ? err.message : err);
    return;
  }
  document.getElementById("scanEnabled").checked = Boolean(state.scanEnabled);
  document.getElementById("applyEnabled").checked = Boolean(state.applyEnabled);
  const el = document.getElementById("status");
  const slots = state.activeSlots || (state.currentJob ? [state.currentJob] : []);
  const parked = state.parkedSlots || [];
  document.getElementById("slotList").innerHTML = [
    ...slots.map((slot) => slotLine(slot, false)),
    ...parked.map((slot) => slotLine(slot, true)),
  ].join("");
  if (!state.hasToken) {
    el.textContent = "API token is missing. Open Options.";
  } else {
    el.textContent = !state.applyEnabled
      ? "Apply stopped"
      : state.paused
        ? "Paused"
        : slots.length
          ? `${slots.length} job tab${slots.length === 1 ? "" : "s"} open`
          : "Idle / waiting";
  }
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

  const box = document.getElementById("jobs");
  const listed = await chrome.runtime.sendMessage({ type: "LIST_JOBS" });
  if (!listed?.ok) {
    box.className = "empty";
    box.textContent = listed?.error || "Set Backend URL and token in Options, then Save.";
    return;
  }
  const jobs = listed.jobs || [];
  if (!jobs.length) {
    box.className = "empty";
    box.textContent = "No new jobs yet.";
    return;
  }
  box.className = "";
  box.innerHTML = jobs.map(jobLine).join("");
}

document.getElementById("scanEnabled").onchange = (e) =>
  chrome.runtime.sendMessage({ type: "SET_SCAN", enabled: e.target.checked }).then(refresh);
document.getElementById("applyEnabled").onchange = (e) =>
  chrome.runtime.sendMessage({ type: "SET_APPLY", enabled: e.target.checked }).then(refresh);
document.getElementById("start").onclick = () => chrome.runtime.sendMessage({ type: "START" }).then(refresh);
document.getElementById("pause").onclick = () => chrome.runtime.sendMessage({ type: "PAUSE" }).then(refresh);
document.getElementById("resume").onclick = () => chrome.runtime.sendMessage({ type: "RESUME" }).then(refresh);
document.getElementById("prepare").onclick = () => chrome.runtime.sendMessage({ type: "PREPARE_TAB" });
document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage();
document.getElementById("skip").onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: "SKIP" });
  if (res?.error) document.getElementById("status").textContent = res.error;
  await refresh();
};
document.getElementById("slotList").addEventListener("click", async (event) => {
  const open = event.target.getAttribute("data-open");
  const reopen = event.target.getAttribute("data-reopen");
  if (!open && !reopen) return;
  const res = await chrome.runtime.sendMessage({
    type: open ? "OPEN_JOB" : "REOPEN_JOB",
    jobId: open || reopen,
  });
  if (res?.error) document.getElementById("status").textContent = res.error;
  await refresh();
});
document.getElementById("open").onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: "OPEN_JOB" });
  if (res?.error) document.getElementById("status").textContent = res.error;
  await refresh();
};
document.getElementById("next").onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: "NEXT" });
  if (res?.error) document.getElementById("status").textContent = res.error;
  await refresh();
};
refresh();
setInterval(refresh, 8000);
