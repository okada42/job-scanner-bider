function showActionError(text) {
  const el = document.getElementById("biderStatus");
  el.className = "meta warn";
  el.textContent = text;
}

async function paint() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    const slots = state.activeSlots || (state.currentJob ? [state.currentJob] : []);
    const parked = state.parkedSlots || [];
    document.getElementById("statusLine").textContent = state.paused
      ? "Paused"
      : slots.length
        ? `${slots.length} open job${slots.length === 1 ? "" : "s"}`
        : "No active jobs";
    document.getElementById("slots").innerHTML = slots.length
      ? slots.map((slot) => JobBiderCard.jobCardHtml(slot, { skip: true })).join("")
      : `<p class="meta">Fill window opens the dashboard Max active count of queued URLs. Each job has Open. Skip or close a tab to take the next queued URL.</p>`;
    document.getElementById("parkedHead").hidden = parked.length === 0;
    document.getElementById("parked").innerHTML = parked
      .map((slot) => JobBiderCard.jobCardHtml(slot, { parked: true }))
      .join("");

    const status = document.getElementById("biderStatus");
    if (!state.hasToken) {
      status.className = "meta warn";
      status.textContent = "API token is missing. Open Options and paste the dashboard token.";
    } else if (!state.applyEnabled) {
      status.className = "meta warn";
      status.textContent = "Bider is OFF. Enable apply in the popup, then Fill window.";
    } else if (state.paused) {
      status.className = "meta warn";
      status.textContent = "Bider is paused.";
    } else {
      status.className = "meta";
      status.textContent = "Open prepares 応募画面へ, date, and 新しいテンプレートを作成. Never fills 契約金額.";
    }

    const box = document.getElementById("jobs");
    const listed = await chrome.runtime.sendMessage({ type: "LIST_JOBS" });
    if (!listed?.ok) {
      box.textContent = listed?.error || "Set Backend URL and token in Options.";
      return;
    }
    const shown = new Set([...slots, ...parked].map((slot) => slot.id));
    const jobs = (listed.jobs || []).filter((job) => job?.id && !shown.has(job.id));
    if (!jobs.length) {
      box.textContent = shown.size ? "All queued jobs are already listed above." : "No queued jobs yet.";
      return;
    }
    box.innerHTML = jobs.map((job) => JobBiderCard.jobCardHtml(job)).join("");
  } catch (err) {
    document.getElementById("jobs").textContent = String(err && err.message ? err.message : err);
  }
}

async function runQueueAction(type, extra) {
  showActionError("Working…");
  const res = await chrome.runtime.sendMessage({ type, ...(extra || {}) });
  if (!res?.ok || res.error) {
    showActionError(res?.error || `${type} failed.`);
  }
  await paint();
}

function onSlotClick(event) {
  const open = event.target.getAttribute("data-open");
  const reopen = event.target.getAttribute("data-reopen");
  const skip = event.target.getAttribute("data-skip");
  if (open) runQueueAction("OPEN_JOB", { jobId: open });
  if (reopen) runQueueAction("REOPEN_JOB", { jobId: reopen });
  if (skip) runQueueAction("SKIP", { jobId: skip });
}

document.getElementById("slots").addEventListener("click", onSlotClick);
document.getElementById("parked").addEventListener("click", onSlotClick);
document.getElementById("jobs").addEventListener("click", onSlotClick);
document.getElementById("open").onclick = () => runQueueAction("NEXT");
document.getElementById("skip").onclick = () => runQueueAction("SKIP");
document.getElementById("next").onclick = () => runQueueAction("NEXT");
document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage();
document.getElementById("prepare").onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: "PREPARE_TAB" });
  if (res?.error) showActionError(res.error);
  await paint();
};

chrome.storage.onChanged.addListener(paint);
paint();
setInterval(paint, 3000);
