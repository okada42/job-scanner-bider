const KEY = "jsb_token";
export const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

const PROXY_HINT = "API not reached. Set VITE_API_URL or wait for /api proxy deploy.";

function looksLikeHtml(text, res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/html")) return true;
  const t = (text || "").trimStart().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("netlify");
}

export function getToken() {
  return localStorage.getItem(KEY) || "";
}

export function setToken(token) {
  localStorage.setItem(KEY, token);
}

export function unwrapJobs(data) {
  if (Array.isArray(data)) return { jobs: data, total: data.length, expired: 0 };
  return {
    jobs: Array.isArray(data?.jobs) ? data.jobs : [],
    total: Number(data?.total) || 0,
    expired: Number(data?.expired) || 0,
  };
}

export async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers["X-API-Token"] = token;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "omit" });
  const text = await res.text();
  if (looksLikeHtml(text, res)) {
    throw new Error(PROXY_HINT);
  }
  if (!res.ok) {
    throw new Error(text || res.statusText);
  }
  if (res.status === 204 || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(PROXY_HINT);
  }
}

export async function fetchJobsPage({ limit, offset, newOnly = true } = {}) {
  const data = await api(`/api/jobs?limit=${limit}&offset=${offset}&new_only=${newOnly}`);
  return unwrapJobs(data);
}

export async function fetchBiderQueue() {
  try {
    const data = await api("/api/jobs/bider");
    if (data && !Array.isArray(data)) {
      const active = Array.isArray(data.active) ? data.active : data.current ? [data.current] : [];
      return { current: data.current || active[0] || null, active, queued: data.queued || [] };
    }
  } catch {
    /* older backends only expose /pending */
  }
  const pending = await api("/api/jobs/pending");
  const queued = Array.isArray(pending) ? pending : pending?.queued || [];
  return { current: null, active: [], queued };
}
