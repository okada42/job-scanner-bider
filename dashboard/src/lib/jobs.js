export const PLATFORMS = ["crowdworks", "lancers", "coconala"];
export const LABELS = { crowdworks: "CrowdWorks", lancers: "Lancers", coconala: "Coconala" };
export const PAGE_SIZES = [10, 20];
export const DEFAULT_PAGE_SIZE = 20;
export const AGE_STATUSES = new Set(["PROCESSING", "COMPLETED", "SENT_TO_BIDER", "WAITING_FOR_USER"]);
const SENT_CLAIM = new Set(["SENT_TO_BIDER", "PROCESSING", "PROPOSAL_PAGE_READY", "WAITING_FOR_USER", "COMPLETED"]);
const SKIPPED_CLAIM = new Set(["SKIPPED", "CLOSED", "FAILED"]);

export function statusPillClass(status) {
  if (status === "QUEUED") return "on";
  if (status === "PROCESSING" || status === "SENT_TO_BIDER" || status === "WAITING_FOR_USER") return "progress";
  if (status === "COMPLETED") return "done";
  return "";
}

export function claimStateLabel(status) {
  const raw = String(status || "").trim().toUpperCase();
  if (SKIPPED_CLAIM.has(raw)) return "skipped";
  if (SENT_CLAIM.has(raw)) return "ready";
  return "queued";
}

export function userStatePillClass(state) {
  if (state === "queued") return "on";
  if (state === "ready") return "progress";
  if (state === "skipped") return "off";
  return "";
}

export function jobUserStates(job) {
  if (Array.isArray(job?.user_states) && job.user_states.length) {
    return job.user_states
      .map((row) => ({
        actor: String(row?.actor || "").trim(),
        state: String(row?.state || claimStateLabel(row?.status) || "queued").toLowerCase().replace(/^sent$/, "ready"),
        updated_at: row?.updated_at || null,
      }))
      .filter((row) => row.actor);
  }
  if (Array.isArray(job?.claims) && job.claims.length) {
    return job.claims
      .map((row) => ({
        actor: String(row?.actor || "").trim(),
        state: claimStateLabel(row?.status),
        updated_at: row?.updated_at || null,
      }))
      .filter((row) => row.actor && !/^ext-/i.test(row.actor));
  }
  const fallback = claimStateLabel(job?.status);
  return fallback ? [{ actor: "", state: fallback, updated_at: job?.status_at || job?.updated_at || null }] : [];
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

export function userStateAgeLabel(states, now = Date.now()) {
  let latest = NaN;
  for (const row of states || []) {
    if (row?.state !== "ready" || !row.updated_at) continue;
    const started = Date.parse(row.updated_at);
    if (Number.isFinite(started) && (!Number.isFinite(latest) || started > latest)) latest = started;
  }
  if (!Number.isFinite(latest)) return null;
  return `for ${formatDuration(now - latest)}`;
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
  return (jobs || []).some((job) => jobUserStates(job).some((row) => row.state === "ready" && row.updated_at));
}
