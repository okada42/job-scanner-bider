const $ = (id) => document.getElementById(id);
let token = localStorage.getItem("api_token") || "";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

function pill(on, onText, offText) {
  return `<span class="pill ${on ? "on" : "off"}">${on ? onText : offText}</span>`;
}

async function refresh() {
  const status = await api("/api/scanners/status");
  $("overall-dot").textContent = status.overall;
  $("overall-dot").className = `pill ${status.overall_enabled ? "on" : "off"}`;
  const platforms = ["crowdworks", "lancers", "coconala"];
  $("platforms").innerHTML = `<h2>Platforms</h2>` + platforms.map((p) => {
    const on = status.platforms?.[p] !== false;
    return `<div class="source">
      <div><div class="title">${p}</div>${pill(on, "ON", "OFF")}</div>
      <div class="row">
        <button class="small" data-p="${p}" data-act="start">START</button>
        <button class="small ghost" data-p="${p}" data-act="stop">STOP</button>
      </div>
    </div>`;
  }).join("");
  $("platforms").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    await api(`/api/scanners/platforms/${btn.dataset.p}/${btn.dataset.act}`, { method: "POST" });
    refresh();
  };

  $("sources").innerHTML = (status.sources || []).map((s) => `
    <div class="source">
      <div>
        <div class="title">${s.name || s.platform} ${pill(s.enabled, "🟢", "🔴")}</div>
        <div class="meta">${s.platform} · interval ${s.scan_interval}s · ${s.url}</div>
        <div class="meta">${s.last_error ? "Error: " + s.last_error : (s.last_scanned_at || "never scanned")}</div>
      </div>
      <div class="row">
        <label class="meta">sec <input class="interval" data-id="${s.id}" type="number" min="5" value="${s.scan_interval}" style="width:72px" /></label>
        <button class="small" data-scan="${s.id}">Scan</button>
        <button class="small ghost" data-toggle="${s.id}" data-on="${s.enabled}">${s.enabled ? "Disable" : "Enable"}</button>
        <button class="small ghost" data-del="${s.id}">Delete</button>
      </div>
    </div>
  `).join("") || `<p class="muted">No sources yet. Add a public listing URL.</p>`;

  $("sources").onchange = async (e) => {
    if (!e.target.classList.contains("interval")) return;
    await api(`/api/sources/${e.target.dataset.id}`, { method: "PATCH", body: { scan_interval: Number(e.target.value) } });
  };
  $("sources").onclick = async (e) => {
    const t = e.target;
    if (t.dataset.scan) await api(`/api/sources/${t.dataset.scan}/scan`, { method: "POST" });
    if (t.dataset.toggle) await api(`/api/sources/${t.dataset.toggle}`, { method: "PATCH", body: { enabled: t.dataset.on !== "true" } });
    if (t.dataset.del) await api(`/api/sources/${t.dataset.del}`, { method: "DELETE" });
    if (t.dataset.scan || t.dataset.toggle || t.dataset.del) refresh();
  };

  const settings = await api("/api/settings");
  $("bider-mode").value = settings.mode || "semi-auto";
  $("bider-enabled").checked = !!settings.enabled;
  $("max-active").value = settings.max_active_jobs ?? 1;
  $("max-queue").value = settings.max_queue_size ?? 50;

  const queue = await api("/api/jobs/queue");
  $("queue").innerHTML = `
    <div class="meta">CURRENT</div>
    ${(queue.active || []).map(jobLine).join("") || "<p class='muted'>None</p>"}
    <div class="meta" style="margin-top:8px">QUEUE</div>
    ${(queue.queued || []).map(jobLine).join("") || "<p class='muted'>Empty</p>"}
  `;
  const payload = await api("/api/jobs?limit=40");
  const jobs = Array.isArray(payload) ? payload : payload?.jobs || [];
  $("jobs").innerHTML = jobs.map(jobLine).join("") || "<p class='muted'>No jobs yet</p>";
}

function jobLine(j) {
  return `<div class="job">
    <div>
      <div class="title">${j.title || j.external_job_id}</div>
      <div class="meta">${j.platform} · ${j.budget || "-"} · ${j.status} · ${j.client || ""}</div>
    </div>
    <a href="${j.url}" target="_blank" rel="noreferrer">Open</a>
  </div>`;
}

$("login-btn").onclick = async () => {
  token = $("token").value.trim();
  try {
    await api("/api/me");
    localStorage.setItem("api_token", token);
    $("login").hidden = true;
    $("app").hidden = false;
    refresh();
    connectWs();
  } catch {
    $("login-error").textContent = "Invalid token";
  }
};

$("start-all").onclick = async () => { await api("/api/scanners/start", { method: "POST" }); refresh(); };
$("stop-all").onclick = async () => { await api("/api/scanners/stop", { method: "POST" }); refresh(); };
$("save-bider").onclick = async () => {
  await api("/api/settings", {
    method: "PUT",
    body: {
      enabled: $("bider-enabled").checked,
      mode: $("bider-mode").value,
      max_active_jobs: Number($("max-active").value),
      max_queue_size: Number($("max-queue").value),
    },
  });
  refresh();
};

$("add-source").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const keywords = (fd.get("keywords") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const rules = {};
  if (fd.get("minimum_budget")) rules.minimum_budget = Number(fd.get("minimum_budget"));
  if (fd.get("maximum_applications")) rules.maximum_applications = Number(fd.get("maximum_applications"));
  if (keywords.length) rules.keywords = keywords;
  await api("/api/sources", {
    method: "POST",
    body: {
      name: fd.get("name") || null,
      url: fd.get("url"),
      scan_interval: Number(fd.get("scan_interval") || 20),
      rules,
    },
  });
  e.target.reset();
  e.target.scan_interval.value = 20;
  refresh();
};

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/dashboard?token=${encodeURIComponent(token)}`);
  ws.onmessage = () => refresh();
}

if (token) {
  api("/api/me").then(() => {
    $("login").hidden = true;
    $("app").hidden = false;
    refresh();
    connectWs();
  }).catch(() => localStorage.removeItem("api_token"));
}
