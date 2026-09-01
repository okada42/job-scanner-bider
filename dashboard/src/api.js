const KEY = "jsb_token";
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export function getToken() {
  return localStorage.getItem(KEY) || "";
}

export function setToken(token) {
  localStorage.setItem(KEY, token);
}

export async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-API-Token": getToken(),
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}
