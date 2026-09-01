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
