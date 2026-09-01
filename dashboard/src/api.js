const KEY = "jsb_token";
export const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

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
  if (!res.ok) {
    throw new Error(text || res.statusText);
  }
  if (res.status === 204 || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      API_BASE
        ? "Backend returned a non-JSON response."
        : "VITE_API_URL is empty. Set it on Netlify to the Railway URL and rebuild; local Vite needs none (proxy)."
    );
  }
}
