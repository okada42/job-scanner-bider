import { useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api";

const PLATFORMS = ["crowdworks", "lancers", "coconala"];
const LABELS = { crowdworks: "CrowdWorks", lancers: "Lancers", coconala: "Coconala" };

export default function App() {
  const [token, setTok] = useState(getToken());
  const [login, setLogin] = useState(getToken());
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [bider, setBider] = useState(null);
  const [form, setForm] = useState({
    platform: "crowdworks",
    url: "",
    name: "",
    scan_interval: 20,
    minimum_budget: "",
    maximum_applications: "",
    keywords: "",
  });

  const authed = Boolean(token);

  async function refresh() {
    const scanners = await api("/api/scanners");
    const settings = await api("/api/settings");
    const jobList = await api("/api/jobs?limit=80");
    setData(scanners);
    setBider(settings.bider);
    setJobs(jobList);
  }

  useEffect(() => {
    if (!authed) return;
    refresh().catch((e) => setError(e.message));
    const t = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [authed]);

  async function tryLogin(e) {
    e.preventDefault();
    setError("");
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ token: login }),
      });
      if (!res?.ok) {
        setError("Invalid token");
        return;
      }
      setToken(login);
      setTok(login);
    } catch (err) {
      setError(err.message || "Login failed");
    }
  }

  if (!authed) {
    return (
      <div className="login-wrap">
        <form className="card login" onSubmit={tryLogin}>
          <h1>Job Scanner</h1>
          <p>Enter the backend API token.</p>
          <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="API_TOKEN" />
          <button type="submit">Sign in</button>
          {error && <p className="err">{error}</p>}
        </form>
      </div>
    );
  }

  const control = data?.control;
  const platforms = data?.platforms || {};
  const sources = data?.sources || [];

  return (
    <div className="page">
      <header>
        <div>
          <h1>JOB SCANNER</h1>
          <p className="muted">Queue lives in Supabase. Discord alerts on match. Interval is per source.</p>
        </div>
        <div className="overall">
          <span className={`dot ${control?.enabled ? "on" : "off"}`} />
          Overall: {control?.enabled ? "RUNNING" : "STOPPED"}
          <button onClick={() => api(control?.enabled ? "/api/scanners/stop" : "/api/scanners/start", { method: "POST" }).then(refresh)}>
            {control?.enabled ? "STOP ALL" : "START ALL"}
          </button>
        </div>
      </header>

      {error && <p className="err">{error}</p>}

      <section className="grid3">
        {PLATFORMS.map((p) => (
          <article key={p} className="card">
            <div className="row">
              <strong>{LABELS[p]}</strong>
              <span className={`pill ${platforms[p] && control?.enabled ? "on" : "off"}`}>
                {platforms[p] && control?.enabled ? "ON" : "OFF"}
              </span>
            </div>
            <button
              onClick={() =>
                api(`/api/scanners/platforms/${p}/${platforms[p] ? "stop" : "start"}`, { method: "POST" }).then(refresh)
              }
            >
              {platforms[p] ? "STOP" : "START"}
            </button>
          </article>
        ))}
      </section>

      <section className="card">
        <h2>Add monitored URL</h2>
        <form
          className="add"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const rules = {
              minimum_budget: form.minimum_budget ? Number(form.minimum_budget) : null,
              maximum_applications: form.maximum_applications ? Number(form.maximum_applications) : null,
              keywords: form.keywords
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            };
            await api("/api/sources", {
              method: "POST",
              body: JSON.stringify({
                platform: form.platform,
                url: form.url,
                name: form.name || null,
                scan_interval: Number(form.scan_interval) || 20,
                rules,
              }),
            });
            setForm({ ...form, url: "", name: "" });
            refresh();
          }}
        >
          <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {LABELS[p]}
              </option>
            ))}
          </select>
          <input placeholder="Public listing URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          <input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label>
            Interval (sec)
            <input
              type="number"
              min="5"
              value={form.scan_interval}
              onChange={(e) => setForm({ ...form, scan_interval: e.target.value })}
            />
          </label>
          <input placeholder="Min budget" value={form.minimum_budget} onChange={(e) => setForm({ ...form, minimum_budget: e.target.value })} />
          <input placeholder="Max applications" value={form.maximum_applications} onChange={(e) => setForm({ ...form, maximum_applications: e.target.value })} />
          <input placeholder="Keywords, comma separated" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          <button type="submit">Add source</button>
        </form>
      </section>

      <section className="card">
        <h2>Sources</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Platform</th>
              <th>Interval</th>
              <th>Last scan</th>
              <th>Found</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className={`dot ${s.enabled && platforms[s.platform] && control?.enabled ? "on" : "off"}`} />
                </td>
                <td>
                  <div>{s.name || LABELS[s.platform]}</div>
                  <a className="url" href={s.url} target="_blank" rel="noreferrer">
                    {s.url}
                  </a>
                  {s.last_error && <div className="err small">{s.last_error}</div>}
                </td>
                <td>{LABELS[s.platform]}</td>
                <td>
                  <input
                    className="narrow"
                    type="number"
                    min="5"
                    defaultValue={s.scan_interval}
                    onBlur={async (e) => {
                      const v = Number(e.target.value);
                      if (v && v !== s.scan_interval) {
                        await api(`/api/sources/${s.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ scan_interval: v }),
                        });
                        refresh();
                      }
                    }}
                  />
                  <span className="muted"> sec</span>
                </td>
                <td>{s.last_scanned_at ? new Date(s.last_scanned_at).toLocaleTimeString() : "—"}</td>
                <td>{s.last_job_count ?? "—"}</td>
                <td className="actions">
                  <button
                    onClick={() =>
                      api(`/api/sources/${s.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ enabled: !s.enabled }),
                      }).then(refresh)
                    }
                  >
                    {s.enabled ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => api(`/api/sources/${s.id}/scan`, { method: "POST" }).then(refresh)}>Scan</button>
                  <button className="danger" onClick={() => api(`/api/sources/${s.id}`, { method: "DELETE" }).then(refresh)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="split">
        <article className="card">
          <h2>Bider</h2>
          {bider && (
            <div className="bider">
              <label>
                Mode
                <select
                  value={bider.mode}
                  onChange={(e) =>
                    api("/api/settings", { method: "PUT", body: JSON.stringify({ mode: e.target.value }) }).then(refresh)
                  }
                >
                  <option value="auto">auto</option>
                  <option value="semi-auto">semi-auto</option>
                  <option value="paused">paused</option>
                </select>
              </label>
              <label>
                Max active
                <input
                  type="number"
                  defaultValue={bider.max_active_jobs}
                  onBlur={(e) =>
                    api("/api/settings", {
                      method: "PUT",
                      body: JSON.stringify({ max_active_jobs: Number(e.target.value) }),
                    }).then(refresh)
                  }
                />
              </label>
            </div>
          )}
          <Queue jobs={jobs} />
        </article>
        <article className="card grow">
          <h2>Jobs</h2>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Platform</th>
                <th>Title</th>
                <th>Budget</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <span className={`pill ${j.status === "QUEUED" ? "on" : ""}`}>{j.status}</span>
                  </td>
                  <td>{LABELS[j.platform] || j.platform}</td>
                  <td>
                    {j.title || j.external_job_id}
                    <div className="muted">{j.client}</div>
                  </td>
                  <td>{j.budget || "—"}</td>
                  <td>
                    <a href={j.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>
    </div>
  );
}

function Queue({ jobs }) {
  const queued = useMemo(
    () => jobs.filter((j) => ["QUEUED", "SENT_TO_BIDER", "PROCESSING", "WAITING_FOR_USER"].includes(j.status)),
    [jobs]
  );
  const current = queued.find((j) => j.status !== "QUEUED");
  const rest = queued.filter((j) => j.status === "QUEUED");
  return (
    <div>
      <h3>CURRENT</h3>
      <p>{current ? `${current.platform} ${current.budget || ""} — ${current.title || current.url}` : "None"}</p>
      <h3>QUEUE</h3>
      <ol>
        {rest.slice(0, 8).map((j) => (
          <li key={j.id}>
            {LABELS[j.platform]} {j.budget || ""} {j.title || j.external_job_id}
          </li>
        ))}
      </ol>
    </div>
  );
}
