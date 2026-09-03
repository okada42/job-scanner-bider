function jobEsc(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function jobSafeUrl(url) {
  const raw = String(url || "");
  if (raw.startsWith("https://") || raw.startsWith("http://")) return raw;
  return "";
}

function jobShortDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return raw.replace(/\s+/g, " ");
}

function jobExtract(job) {
  return job?.extract && typeof job.extract === "object" ? job.extract : {};
}

function jobClientName(job) {
  const extract = jobExtract(job);
  if (extract.client && extract.client !== "—") return extract.client;
  const client = job?.client;
  if (client && typeof client === "object") return client.name || client.userDisplayName || "";
  return client || "";
}

function jobPosted(job) {
  const extract = jobExtract(job);
  return jobShortDate(
    extract.postedLabel || extract.postedAt || job?.posted_at || job?.postedAt || job?.detected_at || ""
  );
}

function jobDeadline(job) {
  const extract = jobExtract(job);
  return jobShortDate(job?.deadline || extract.deadline || extract.dueAt || "");
}

function jobBudget(job) {
  const extract = jobExtract(job);
  return job?.budget || extract.budget || "";
}

function jobIsParked(job, parked) {
  if (parked) return true;
  const status = String(job?.status || job?.parkedReason || job?.claim_status || "").toUpperCase();
  return status === "SKIPPED" || status === "CLOSED" || status === "FAILED";
}

function compactFlag(ok, label) {
  if (ok === true) return `${label}✓`;
  if (ok === false) return `${label}✗`;
  return `${label}—`;
}

function jobCardHtml(job, opts) {
  const options = opts || {};
  const extract = jobExtract(job);
  const href = jobSafeUrl(job.url || extract.url);
  const parked = jobIsParked(job, options.parked);
  const id = jobEsc(job.id || "");
  const action = parked
    ? `<button type="button" data-reopen="${id}">Reopen</button>`
    : `<button type="button" data-open="${id}">Open</button>`;
  const bits = [
    jobClientName(job) || "—",
    compactFlag(extract.identity, "本人"),
    compactFlag(extract.ruleCheck, "発注"),
    jobBudget(job) || "—",
    `掲載 ${jobPosted(job) || "—"}`,
    `締切 ${jobDeadline(job) || "—"}`,
  ];
  return `<article class="row${parked ? " parked" : ""}" data-id="${id}">
    <div class="line1"><span class="url" title="${jobEsc(href || "")}">${jobEsc(href || "—")}</span>${action}</div>
    <div class="line2">${bits.map(jobEsc).join(" · ")}</div>
  </article>`;
}

globalThis.JobBiderCard = { jobCardHtml, jobIsParked };
