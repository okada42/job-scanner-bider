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
  const status = String(job?.status || job?.parkedReason || "").toUpperCase();
  return status === "SKIPPED" || status === "CLOSED" || status === "FAILED";
}

function jobCardHtml(job, opts) {
  const options = opts || {};
  const extract = jobExtract(job);
  const marks = JobBiderVerify.clientMarks(extract);
  const href = jobEsc(jobSafeUrl(job.url || extract.url) || "—");
  const parked = jobIsParked(job, options.parked);
  const id = jobEsc(job.id || "");
  const action = parked
    ? `<button type="button" data-reopen="${id}">Reopen</button>`
    : `<button type="button" data-open="${id}">Open</button>${
        options.skip ? `<button type="button" data-skip="${id}">Skip</button>` : ""
      }`;
  return `<article class="slot${parked ? " parked" : ""}" data-id="${id}">
    <div class="url">${href}</div>
    <div>Client ${jobEsc(jobClientName(job) || "—")}</div>
    <div class="mark">${jobEsc(marks.identity)}</div>
    <div class="mark">${jobEsc(marks.rule)}</div>
    <div class="price">Budget ${jobEsc(jobBudget(job) || "—")}</div>
    <div class="meta">Published ${jobEsc(jobPosted(job) || "—")}</div>
    <div class="meta">Deadline ${jobEsc(jobDeadline(job) || "—")}</div>
    ${action}
  </article>`;
}

globalThis.JobBiderCard = { jobCardHtml, jobIsParked };
