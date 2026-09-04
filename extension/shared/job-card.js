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

function compactWhen(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const dates = globalThis.JobBiderDates;
  if (dates && dates.formatCompact) {
    const compact = dates.formatCompact(text);
    if (compact) return compact;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (iso) {
    const date = `${Number(iso[2])}/${Number(iso[3])}`;
    return iso[4] != null ? `${date} ${iso[4]}:${iso[5]}` : date;
  }
  return text.replace(/\s+/g, " ");
}

function jobPosted(job) {
  const extract = jobExtract(job);
  return compactWhen(extract.postedLabel || extract.postedAt || job?.posted_at || job?.postedAt || job?.detected_at);
}

function jobDeadline(job) {
  const extract = jobExtract(job);
  return compactWhen(job?.deadline || extract.deadline || extract.dueAt);
}

function jobBudget(job) {
  const extract = jobExtract(job);
  return String(job?.budget || extract.budget || "").trim();
}

function jobIsHourly(job) {
  const extract = jobExtract(job);
  if (extract.hourly === true || job?.hourly === true) return true;
  if (extract.hourly === false || job?.hourly === false) return false;
  return /時給|時間単価|時間報酬|\/時|\bhourly\b/i.test(`${jobBudget(job)} ${job?.title || ""} ${extract.tag || ""}`);
}

function jobIsParked(job, parked) {
  if (parked) return true;
  const status = String(job?.status || job?.parkedReason || job?.claim_status || "").toUpperCase();
  return status === "SKIPPED" || status === "CLOSED" || status === "FAILED" || status === "COMPLETED";
}

function jobTag(job, opts) {
  const options = opts || {};
  const reason = String(job?.parkedReason || "").toLowerCase();
  if (reason === "sent" || options.sent) return "sent";
  if (reason === "closed") return "closed";
  const status = String(job?.claim_status || job?.status || "").toUpperCase();
  if (status === "COMPLETED") return "sent";
  if (options.parked || status === "SKIPPED" || status === "FAILED" || reason === "skipped") return "skipped";
  if (status === "CLOSED") return "closed";
  if (options.ready || options.sent || ["SENT_TO_BIDER", "PROCESSING", "PROPOSAL_PAGE_READY", "WAITING_FOR_USER"].includes(status)) {
    return "ready";
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

function jobIsManual(job, opts) {
  if (opts && opts.manual) return true;
  if (job?.manual) return true;
  return Number(job?.priority || 0) >= 100;
}

function jobCardHtml(job, opts) {
  const options = opts || {};
  const extract = jobExtract(job);
  const href = jobSafeUrl(job.url || extract.url);
  const parked = jobIsParked(job, options.parked);
  const id = jobEsc(job.id || "");
  const tag = jobTag(job, options);
  const focused = Boolean(options.focused);
  const manual = jobIsManual(job, options);
  const hourly = jobIsHourly(job);
  const action = parked
    ? `<button type="button" class="mini" data-reopen="${id}">Reopen</button>`
    : `<button type="button" class="mini" data-open="${id}">Open</button><button type="button" class="mini" data-focus="${id}">Focus</button>${
        options.skip ? `<button type="button" class="mini" data-skip="${id}">Skip</button>` : ""
      }`;
  const pay = hourly ? "⏰" : "💰";
  const budget = jobBudget(job);
  const meta = [
    compactFlag(extract.identity, "本"),
    compactFlag(extract.ruleCheck, "発"),
    pay,
    budget || "—",
  ];
  const dates = [`掲 ${jobPosted(job) || "—"}`, `締 ${jobDeadline(job) || "—"}`];
  const extra =
    jobOpenedOnce(job) || options.opened
      ? `<div class="line3">${jobEsc(jobClientName(job) || "—")} · 募集 ${jobEsc(extract.achievement || "—")} · 完了 ${jobEsc(
          extract.completionRate || "—"
        )}</div>`
      : "";
  return `<article class="row${parked ? " parked" : ""}${focused ? " focused" : ""}${manual ? " manual" : ""}" data-id="${id}">
    <div class="line1">
      <span class="tag tag-${tag}">${tag}</span>
      <span class="url" title="${jobEsc(href || "")}">${jobEsc(href || "—")}</span>
      <span class="acts">${action}</span>
    </div>
    <div class="line2">${dates.map(jobEsc).join(" · ")}</div>
    <div class="line2">${meta.map(jobEsc).join(" ")}</div>
    ${extra}
  </article>`;
}

globalThis.JobBiderCard = { jobCardHtml, jobIsParked, jobTag, jobIsManual };
