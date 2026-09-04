function showActionError(text) {
  const el = document.getElementById("biderStatus");
  el.className = "meta warn";
  el.textContent = text;
}

function parkedKind(slot) {
  const reason = String(slot?.parkedReason || "").toLowerCase();
  const status = String(slot?.status || slot?.claim_status || "").toUpperCase();
  if (reason === "sent" || status === "COMPLETED") return "sent";
  if (reason === "closed" || status === "CLOSED") return "closed";
  return "skipped";
}

function fillGroup(id, headId, boxId, rows, label) {
  const box = document.getElementById(boxId);
  const list = document.getElementById(id);
  const head = document.getElementById(headId);
  box.hidden = rows.length === 0;
  head.textContent = `${label} (${rows.length})`;
  list.innerHTML = rows
    .map((slot) =>
      JobBiderCard.jobCardHtml(slot, {
        parked: true,
        sent: parkedKind(slot) === "sent",
        opened: Boolean(slot.extract),
        manual: Boolean(slot.manual),
      })
    )
    .join("");
}

async function paint() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    const slots = state.activeSlots || (state.currentJob ? [state.currentJob] : []);
    const parked = state.parkedSlots || [];
    const sent = parked.filter((slot) => parkedKind(slot) === "sent");
    const skipped = parked.filter((slot) => parkedKind(slot) === "skipped");
    const closed = parked.filter((slot) => parkedKind(slot) === "closed");
    document.getElementById("profileLine").textContent = state.profileUser
      ? `Profile · ${state.profileUser}`
      : "Profile · open CrowdWorks while logged in";
    document.getElementById("statusLine").textContent = state.paused
      ? "Paused"
      : slots.length
        ? `${slots.length} open job${slots.length === 1 ? "" : "s"}`
        : "No active jobs";
    document.getElementById("slots").innerHTML = slots.length
      ? slots
          .map((slot) =>
            JobBiderCard.jobCardHtml(slot, {
              skip: true,
              ready: true,
              opened: true,
              focused: Boolean(state.focusedTabId && slot.tabId === state.focusedTabId),
              manual: Boolean(slot.manual),
            })
          )
          .join("")
      : `<p class="meta">Fill window opens the dashboard Max active count of queued URLs. Each job has Open. Skip or close a tab to take the next queued URL.</p>`;
    fillGroup("sent", "sentHead", "sentBox", sent, "SENT");
    fillGroup("skipped", "skippedHead", "skippedBox", skipped, "SKIPPED");
    fillGroup("closed", "closedHead", "closedBox", closed, "CLOSED");

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
    } else if (state.loginMissing) {
      status.className = "meta warn";
      status.textContent = "CrowdWorksにログインしてください";
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
    box.innerHTML = jobs
      .map((job) => JobBiderCard.jobCardHtml(job, { opened: Boolean(job.openedOnce), manual: Boolean(job.manual) }))
      .join("");
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
  const focus = event.target.getAttribute("data-focus");
  if (open) runQueueAction("OPEN_JOB", { jobId: open });
  if (reopen) runQueueAction("REOPEN_JOB", { jobId: reopen });
  if (skip) runQueueAction("SKIP", { jobId: skip });
  if (focus) runQueueAction("FOCUS_JOB", { jobId: focus });
}

document.getElementById("slots").addEventListener("click", onSlotClick);
document.getElementById("sent").addEventListener("click", onSlotClick);
document.getElementById("skipped").addEventListener("click", onSlotClick);
document.getElementById("closed").addEventListener("click", onSlotClick);
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
