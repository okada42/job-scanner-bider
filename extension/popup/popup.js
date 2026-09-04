function slotLine(slot, parked, focused) {
  return JobBiderCard.jobCardHtml(slot, {
    parked: Boolean(parked),
    ready: !parked,
    opened: true,
    skip: !parked,
    focused: Boolean(focused),
  });
}

function jobLine(job) {
  return JobBiderCard.jobCardHtml(job, { opened: Boolean(job.openedOnce) });
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
  document.getElementById("profileLine").textContent = state.profileUser
    ? `Profile · ${state.profileUser}`
      : "Profile · open CrowdWorks or Lancers while logged in";
  const el = document.getElementById("status");
  const slots = state.activeSlots || (state.currentJob ? [state.currentJob] : []);
  const parked = state.parkedSlots || [];
  document.getElementById("slotList").innerHTML = [
    ...slots.map((slot) => slotLine(slot, false, state.focusedTabId && slot.tabId === state.focusedTabId)),
    ...parked.map((slot) => slotLine(slot, true, false)),
  ].join("");
  if (!state.hasToken) {
    el.textContent = "API token is missing. Open Options.";
  } else if (state.lancersLoggedOut) {
    el.textContent = "Lancersにログインしてください";
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
  const shown = new Set([...slots, ...parked].map((slot) => slot.id));
  const jobs = (listed.jobs || []).filter((job) => job?.id && !shown.has(job.id));
  if (!jobs.length) {
    box.className = "empty";
    box.textContent = shown.size ? "Queued jobs are listed above." : "No queued jobs yet.";
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

async function onJobClick(event) {
  const open = event.target.getAttribute("data-open");
  const reopen = event.target.getAttribute("data-reopen");
  const skip = event.target.getAttribute("data-skip");
  const focus = event.target.getAttribute("data-focus");
  if (!open && !reopen && !skip && !focus) return;
  const res = await chrome.runtime.sendMessage({
    type: skip ? "SKIP" : focus ? "FOCUS_JOB" : open ? "OPEN_JOB" : "REOPEN_JOB",
    jobId: open || reopen || skip || focus,
  });
  if (res?.error) document.getElementById("status").textContent = res.error;
  await refresh();
}
document.getElementById("slotList").addEventListener("click", onJobClick);
document.getElementById("jobs").addEventListener("click", onJobClick);
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
