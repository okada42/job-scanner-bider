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

function showActionError(text) {
  const el = document.getElementById("biderStatus");
  el.className = "meta warn";
  el.textContent = text;
}

function slotCard(slot, index, mode) {
  const extract = slot.extract || {};
  const marks = JobBiderVerify.clientMarks(extract);
  const href = esc(safeUrl(slot.url || extract.url) || "—");
  const client = esc(extract.client || slot.client || "—");
  const price = esc(slot.budget || extract.budget || "—");
  const parked = mode === "parked";
  const reason = parked ? esc(slot.parkedReason || "closed") : slot.tabId ? "open" : "tab closed";
  const action = parked
    ? `<button type="button" data-reopen="${esc(slot.id)}">Reopen</button>`
    : `<button type="button" data-open="${esc(slot.id)}">Open</button>
       <button type="button" data-skip="${esc(slot.id)}">Skip</button>`;
  return `<article class="slot${parked ? " parked" : ""}" data-id="${esc(slot.id)}">
    <div class="meta">#${index + 1} · ${reason}</div>
    <div class="url">${href}</div>
    <div>👤 ${client}</div>
    <div class="mark">${esc(marks.identity)}</div>
    <div class="mark">${esc(marks.rule)}</div>
    <div class="price">予算 ${price}</div>
    <div class="meta">募集実績 ${esc(extract.achievement || "—")} · 完了率 ${esc(extract.completionRate || "—")}</div>
    ${action}
  </article>`;
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
      ? slots.map((s, i) => slotCard(s, i, "active")).join("")
      : `<p class="meta">Fill window opens queued jobs. Each URL has Open. Skip or close a tab to take the next queued URL.</p>`;
    document.getElementById("parkedHead").hidden = parked.length === 0;
    document.getElementById("parked").innerHTML = parked.map((s, i) => slotCard(s, i, "parked")).join("");

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
    const jobs = listed.jobs || [];
    if (!jobs.length) {
      box.textContent = "No new jobs yet.";
      return;
    }
    box.innerHTML = jobs
      .slice(0, 20)
      .map((j) => {
        const title = esc(j.title || j.external_job_id || "Untitled");
        const meta = [j.status, j.platform, j.client, j.budget].filter(Boolean).map(esc).join(" · ");
        return `<div class="job"><div>${title}</div><div class="meta">${meta}</div></div>`;
      })
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
  if (open) runQueueAction("OPEN_JOB", { jobId: open });
  if (reopen) runQueueAction("REOPEN_JOB", { jobId: reopen });
  if (skip) runQueueAction("SKIP", { jobId: skip });
}

document.getElementById("slots").addEventListener("click", onSlotClick);
document.getElementById("parked").addEventListener("click", onSlotClick);
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
