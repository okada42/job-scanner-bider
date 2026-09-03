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

function paintClient(extract, job) {
  const name = extract?.client || job?.client || "—";
  document.getElementById("clientName").textContent = `👤 ${name}`;
  document.getElementById("clientVerify").textContent = `Verification ${extract?.verification || "—"}`;
  document.getElementById("clientRecord").textContent = `募集実績 ${extract?.achievement || "—"}`;
  document.getElementById("clientRate").textContent = `完了率 ${extract?.completionRate || "—"}`;
  const desc = extract?.details || extract?.description || "";
  if (desc) document.getElementById("desc").textContent = desc.slice(0, 4000);
}

async function paint() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    const job = state.currentJob;
    const extract = state.pageExtract;
    document.getElementById("statusLine").textContent = job
      ? extract?.client || job.client || "Active job"
      : state.paused
        ? "Paused"
        : "No active job";
    paintClient(extract, job);

    const status = document.getElementById("biderStatus");
    if (!state.hasToken) {
      status.className = "meta warn";
      status.textContent = "API token is missing. Open Options and paste the dashboard token.";
    } else if (!state.applyEnabled) {
      status.className = "meta warn";
      status.textContent = "Bider is OFF. Enable apply in the popup, then press NEXT.";
    } else if (state.paused) {
      status.className = "meta warn";
      status.textContent = "Bider is paused.";
    } else {
      status.className = "meta";
      status.textContent = job ? "Active job open in a tab." : "Waiting for a queued job.";
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
        const href = safeUrl(j.url);
        const open = href ? ` <a href="${esc(href)}" target="_blank" rel="noreferrer">Open</a>` : "";
        const meta = [j.status, j.platform, j.client].filter(Boolean).map(esc).join(" · ");
        return `<div class="job"><div>${title}</div><div class="meta">${meta}</div>${open}</div>`;
      })
      .join("");
  } catch (err) {
    document.getElementById("jobs").textContent = String(err && err.message ? err.message : err);
  }
}

async function runQueueAction(type) {
  showActionError("Working…");
  const res = await chrome.runtime.sendMessage({ type });
  if (!res?.ok || res.error) {
    showActionError(res?.error || `${type} failed.`);
  }
  await paint();
}

document.getElementById("skip").onclick = () => runQueueAction("SKIP");
document.getElementById("next").onclick = () => runQueueAction("NEXT");
document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage();
document.getElementById("prepare").onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: "PREPARE_TAB" });
  if (res?.extract) paintClient(res.extract);
  if (res?.description) document.getElementById("desc").textContent = res.description.slice(0, 4000);
  else if (res?.stage) document.getElementById("desc").textContent = `Stage: ${res.stage}`;
  else document.getElementById("desc").textContent = res?.error || "Prepare failed.";
  await paint();
};

chrome.storage.onChanged.addListener(paint);
paint();
setInterval(paint, 3000);
