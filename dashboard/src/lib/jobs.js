export const PLATFORMS = ["crowdworks", "lancers", "coconala"];
export const LABELS = { crowdworks: "CrowdWorks", lancers: "Lancers", coconala: "Coconala" };
export const PAGE_SIZES = [10, 20];
export const DEFAULT_PAGE_SIZE = 20;
export const AGE_STATUSES = new Set(["PROCESSING", "COMPLETED", "SENT_TO_BIDER", "WAITING_FOR_USER"]);

export function statusPillClass(status) {
  if (status === "QUEUED") return "on";
  if (status === "PROCESSING" || status === "SENT_TO_BIDER" || status === "WAITING_FOR_USER") return "progress";
  if (status === "COMPLETED") return "done";
  return "";
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function statusAgeLabel(job, now = Date.now()) {
  if (!AGE_STATUSES.has(job?.status)) return null;
  const raw = job.status_at || job.updated_at;
  if (!raw) return null;
  const started = Date.parse(raw);
  if (!Number.isFinite(started)) return null;
  const dur = formatDuration(now - started);
  if (job.status === "COMPLETED") return `${dur} ago`;
  return `for ${dur}`;
}

export function uniqueClientNames(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names || []) {
    const name = String(raw || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function splitClientNames(text) {
  return uniqueClientNames(String(text || "").split(/[\n\r,;、，\t]+/));
}

export function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function needsClock(jobs) {
  return (jobs || []).some((job) => AGE_STATUSES.has(job?.status));
}
