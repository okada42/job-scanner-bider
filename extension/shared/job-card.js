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
  const raw = String(
    extract.postedLabel || extract.postedAt || job?.posted_at || job?.postedAt || job?.detected_at || ""
  ).trim();
  if (!raw) return "";
  const dates = globalThis.JobBiderDates;
  if (dates && dates.parseJpDate && dates.formatJpDate) {
    const parts = dates.parseJpDate(raw);
    if (parts) return dates.formatJpDate(parts);
  }
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (iso) return iso[2] ? `${iso[1]} ${iso[2]}` : iso[1];
  return raw.replace(/\s+/g, " ");
}

function jobDeadline(job) {
  const extract = jobExtract(job);
  return String(job?.deadline || extract.deadline || extract.dueAt || "")
    .trim()
    .replace(/\s+/g, " ");
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

function jobTag(job, opts) {
  const options = opts || {};
  const reason = String(job?.parkedReason || "").toLowerCase();
  if (reason === "closed") return "closed";
  const status = String(job?.claim_status || job?.status || "").toUpperCase();
  if (options.parked || status === "SKIPPED" || status === "FAILED" || reason === "skipped") return "skipped";
  if (status === "CLOSED") return "closed";
  if (options.sent || ["SENT_TO_BIDER", "PROCESSING", "PROPOSAL_PAGE_READY", "WAITING_FOR_USER"].includes(status)) {
    return "sent";
  }
  return "queued";
}

function compactFlag(ok, label) {
  if (ok === true) return `${label}✓`;
  if (ok === false) return `${label}✗`;
  return `${label}—`;
}

function jobOpenedOnce(job) {
  return Boolean(job?.openedOnce || job?.openedAt);
}

function jobCardHtml(job, opts) {
  const options = opts || {};
  const extract = jobExtract(job);
  const href = jobSafeUrl(job.url || extract.url);
  const parked = jobIsParked(job, options.parked);
  const id = jobEsc(job.id || "");
  const tag = jobTag(job, options);
  const focused = Boolean(options.focused);
  const action = parked
    ? `<button type="button" class="mini" data-reopen="${id}">Reopen</button>`
    : `<button type="button" class="mini" data-open="${id}">Open</button><button type="button" class="mini" data-focus="${id}">Focus</button>${
        options.skip ? `<button type="button" class="mini" data-skip="${id}">Skip</button>` : ""
      }`;
  const bits = [
    jobClientName(job) || "—",
    compactFlag(extract.identity, "本人"),
    compactFlag(extract.ruleCheck, "発注"),
    jobBudget(job) || "—",
    `掲載 ${jobPosted(job) || "—"}`,
    `締切 ${jobDeadline(job) || "—"}`,
  ];
  const extra =
    jobOpenedOnce(job) || options.opened
      ? `<div class="line3">募集実績 ${jobEsc(extract.achievement || "—")} · 完了率 ${jobEsc(
          extract.completionRate || "—"
        )}</div>`
      : "";
  return `<article class="row${parked ? " parked" : ""}${focused ? " focused" : ""}" data-id="${id}">
    <div class="line1">
      <span class="tag tag-${tag}">${tag}</span>
      <span class="url" title="${jobEsc(href || "")}">${jobEsc(href || "—")}</span>
      <span class="acts">${action}</span>
    </div>
    <div class="line2">${bits.map(jobEsc).join(" · ")}</div>
    ${extra}
  </article>`;
}

globalThis.JobBiderCard = { jobCardHtml, jobIsParked, jobTag };
