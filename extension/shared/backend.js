const PRODUCTION_API = "https://job-scanner-bider-production.up.railway.app";
const LOCAL_BACKENDS = new Set(["http://127.0.0.1:8000", "http://localhost:8000"]);

function normalizeBackendUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) return PRODUCTION_API;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "").replace(/\/api$/i, "");
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "job-scannerr.netlify.app" || host.endsWith(".netlify.app")) {
      return PRODUCTION_API;
    }
  } catch (_) {
    return PRODUCTION_API;
  }
  return url;
}

function isLocalhostBackend(url) {
  const base = String(url || "").replace(/\/+$/, "");
  return LOCAL_BACKENDS.has(base) || /^(https?:\/\/)(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
}

function describeFetchError(err, backendUrl) {
  const msg = String(err && err.message ? err.message : err);
  const host = backendUrl || "(empty URL)";
  const network = err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg);
  if (network && isLocalhostBackend(host)) {
    return (
      `Cannot reach ${host}. No local API is running on this computer. ` +
      `Open Options and set Backend URL to ${PRODUCTION_API} (same token as the dashboard).`
    );
  }
  if (network) {
    return (
      `Cannot reach ${host}. Use the Railway API URL, not the Netlify dashboard. ` +
      `Example: ${PRODUCTION_API}`
    );
  }
  return msg;
}
