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

async function paint() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  const job = state.currentJob;
  document.getElementById("title").textContent = job?.title || (state.paused ? "Paused" : "No active job");
  document.getElementById("budget").textContent = job?.budget ? `💰 ${job.budget}` : "";
  document.getElementById("client").textContent = job?.client ? `👤 ${job.client}` : "";
  document.getElementById("deadline").textContent = job?.deadline ? `📅 ${job.deadline}` : "";

  const box = document.getElementById("jobs");
  const listed = await chrome.runtime.sendMessage({ type: "LIST_JOBS" });
  if (!listed?.ok) {
    box.textContent = listed?.error || "Set Backend URL and token in options.";
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
}

document.getElementById("skip").onclick = () => chrome.runtime.sendMessage({ type: "SKIP" }).then(paint);
document.getElementById("next").onclick = () => chrome.runtime.sendMessage({ type: "NEXT" }).then(paint);
document.getElementById("prepare").onclick = async () => {
  const res = await chrome.runtime.sendMessage({ type: "PREPARE_TAB" });
  if (res?.description) document.getElementById("desc").textContent = res.description.slice(0, 4000);
  else if (res?.stage) document.getElementById("desc").textContent = `Stage: ${res.stage}`;
};

chrome.storage.onChanged.addListener(paint);
paint();
setInterval(paint, 3000);
