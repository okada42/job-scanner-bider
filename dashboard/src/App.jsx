import { useCallback, useEffect, useReducer, useState } from "react";
import { api, fetchJobsPage, getToken, setToken } from "./api";
import { AddSourceForm } from "./components/AddSourceForm";
import { BadClients } from "./components/BadClients";
import { HeaderBar } from "./components/HeaderBar";
import { JobsPanel } from "./components/JobsPanel";
import { LoginForm } from "./components/LoginForm";
import { PlatformToggles } from "./components/PlatformToggles";
import { QueuePanel } from "./components/QueuePanel";
import { SourcesPanel } from "./components/SourcesPanel";
import { uniqueClientNames } from "./lib/jobs";
import { initialState, reducer } from "./lib/reducer";

const JOBS_POLL_MS = 4000;
const META_POLL_MS = 20000;

export default function App() {
  const [token, setTok] = useState(getToken);
  const [login, setLogin] = useState(getToken);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinNote, setPinNote] = useState(null);
  const [state, dispatch] = useReducer(reducer, initialState);
  const authed = Boolean(token);

  const loadJobs = useCallback(async (page, pageSize) => {
    const slow = setTimeout(() => dispatch({ type: "updating", updating: true }), 350);
    try {
      const offset = (Math.max(1, page) - 1) * pageSize;
      const { jobs, total, expired } = await fetchJobsPage({ limit: pageSize, offset });
      const pageCount = Math.max(1, Math.ceil((total || 0) / pageSize));
      if (page > pageCount) {
        dispatch({ type: "page", page: pageCount });
        const again = await fetchJobsPage({ limit: pageSize, offset: (pageCount - 1) * pageSize });
        dispatch({ type: "jobs", jobs: again.jobs, total: again.total, expired: again.expired });
      } else {
        dispatch({ type: "jobs", jobs, total, expired });
      }
    } finally {
      clearTimeout(slow);
      dispatch({ type: "updating", updating: false });
    }
  }, []);

  const loadMeta = useCallback(async () => {
    const [scanners, settings] = await Promise.all([api("/api/scanners"), api("/api/settings")]);
    dispatch({ type: "scanners", scanners });
    dispatch({ type: "settings", bider: settings.bider });
  }, []);

  const refreshAll = useCallback(async () => {
    dispatch({ type: "error", error: "" });
    await Promise.all([loadJobs(state.page, state.pageSize), loadMeta()]);
  }, [loadJobs, loadMeta, state.page, state.pageSize]);

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    Promise.all([loadJobs(state.page, state.pageSize), loadMeta()]).catch((err) => {
      if (!cancelled) dispatch({ type: "error", error: err.message || "Could not load dashboard." });
    });
    const jobsTimer = setInterval(() => {
      loadJobs(state.page, state.pageSize).catch(() => {});
    }, JOBS_POLL_MS);
    const metaTimer = setInterval(() => {
      loadMeta().catch(() => {});
    }, META_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(jobsTimer);
      clearInterval(metaTimer);
    };
  }, [authed, state.page, state.pageSize, loadJobs, loadMeta]);

  async function tryLogin(e) {
    e.preventDefault();
    dispatch({ type: "error", error: "" });
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ token: login }),
      });
      if (!res?.ok) {
        dispatch({ type: "error", error: "Invalid token" });
        return;
      }
      setToken(login);
      setTok(login);
    } catch (err) {
      dispatch({ type: "error", error: err.message || "Login failed" });
    }
  }

  const reportBadClient = useCallback(
    async (job) => {
      const client = String(job.client || "").trim();
      if (!client) {
        window.alert("This job has no client name to report.");
        return;
      }
      if (!window.confirm("Bad client?")) return;
      dispatch({ type: "reporting", id: job.id });
      dispatch({ type: "error", error: "" });
      try {
        const next = uniqueClientNames([...(state.scanners?.control?.excluded_clients || []), client]);
        await api("/api/settings/scanner", {
          method: "PUT",
          body: JSON.stringify({ excluded_clients: next }),
        });
        await refreshAll();
      } catch (err) {
        dispatch({ type: "error", error: err.message || "Could not add this client." });
      } finally {
        dispatch({ type: "reporting", id: null });
      }
    },
    [state.scanners, refreshAll]
  );

  const onToggleAll = useCallback(() => {
    const enabled = state.scanners?.control?.enabled;
    api(enabled ? "/api/scanners/stop" : "/api/scanners/start", { method: "POST" })
      .then(refreshAll)
      .catch((err) => dispatch({ type: "error", error: err.message }));
  }, [state.scanners, refreshAll]);

  const onTogglePlatform = useCallback(
    (platform, on) => {
      api(`/api/scanners/platforms/${platform}/${on ? "stop" : "start"}`, { method: "POST" })
        .then(refreshAll)
        .catch((err) => dispatch({ type: "error", error: err.message }));
    },
    [refreshAll]
  );

  const onBadClients = useCallback(
    async (names) => {
      dispatch({ type: "error", error: "" });
      await api("/api/settings/scanner", {
        method: "PUT",
        body: JSON.stringify({ excluded_clients: names }),
      });
      await refreshAll();
    },
    [refreshAll]
  );

  const onAddSource = useCallback(
    async (body) => {
      dispatch({ type: "error", error: "" });
      await api("/api/sources", { method: "POST", body: JSON.stringify(body) });
      await refreshAll();
    },
    [refreshAll]
  );

  const onSourceInterval = useCallback(
    async (source, value) => {
      if (value && value !== source.scan_interval) {
        await api(`/api/sources/${source.id}`, {
          method: "PATCH",
          body: JSON.stringify({ scan_interval: value }),
        });
        await refreshAll();
      }
    },
    [refreshAll]
  );

  const onSourceToggle = useCallback(
    async (source) => {
      await api(`/api/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      await refreshAll();
    },
    [refreshAll]
  );

  const onSourceScan = useCallback(
    async (source) => {
      dispatch({ type: "error", error: "" });
      try {
        const result = await api(`/api/sources/${source.id}/scan`, { method: "POST" });
        dispatch({ type: "scanNote", id: source.id, note: result });
        await refreshAll();
      } catch (err) {
        dispatch({ type: "error", error: err.message || "Scan failed" });
      }
    },
    [refreshAll]
  );

  const onSourceDelete = useCallback(
    async (source) => {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      await refreshAll();
    },
    [refreshAll]
  );

  const onBiderMode = useCallback(
    (mode) => {
      api("/api/settings", { method: "PUT", body: JSON.stringify({ mode }) })
        .then(refreshAll)
        .catch((err) => dispatch({ type: "error", error: err.message }));
    },
    [refreshAll]
  );

  const onBiderMax = useCallback(
    (maxActive) => {
      api("/api/settings", { method: "PUT", body: JSON.stringify({ max_active_jobs: maxActive }) })
        .then(refreshAll)
        .catch((err) => dispatch({ type: "error", error: err.message }));
    },
    [refreshAll]
  );

  const onAddUrls = useCallback(
    async (text) => {
      setPinBusy(true);
      setPinNote(null);
      dispatch({ type: "error", error: "" });
      try {
        const result = await api("/api/jobs/manual", {
          method: "POST",
          body: JSON.stringify({ text }),
        });
        const added = (result.jobs || []).length;
        const skipped = (result.skipped || []).length;
        setPinNote({
          ok: added > 0,
          text:
            added > 0
              ? `Added ${added} URL${added === 1 ? "" : "s"} to the front of the queue.${
                  skipped ? ` Skipped ${skipped} line${skipped === 1 ? "" : "s"}.` : ""
                }`
              : skipped
                ? "No valid job URLs. Use CrowdWorks / Lancers / Coconala listing links, one per line."
                : "No URLs to add.",
        });
        await refreshAll();
        return added > 0;
      } catch (err) {
        setPinNote({ ok: false, text: err.message || "Could not add URLs." });
        return false;
      } finally {
        setPinBusy(false);
      }
    },
    [refreshAll]
  );

  if (!authed) {
    return <LoginForm login={login} error={state.error} onLoginChange={setLogin} onSubmit={tryLogin} />;
  }

  const control = state.scanners?.control;
  const platforms = state.scanners?.platforms || {};
  const sources = state.scanners?.sources || [];

  return (
    <div className="page">
      <HeaderBar
        control={control}
        updating={state.updating}
        loaded={state.loaded}
        onToggleAll={onToggleAll}
      />
      {state.error && <p className="err">{state.error}</p>}

      <section className="jobs-stack">
        <QueuePanel
          bider={state.bider}
          busy={pinBusy}
          note={pinNote}
          onMode={onBiderMode}
          onMaxActive={onBiderMax}
          onAddUrls={onAddUrls}
        />
        <JobsPanel
          jobs={state.jobs}
          total={state.jobsTotal}
          expired={state.jobsExpired}
          page={state.page}
          pageSize={state.pageSize}
          loaded={state.loaded}
          reportingJobId={state.reportingJobId}
          onReport={reportBadClient}
          onPage={(page) => dispatch({ type: "page", page })}
          onPageSize={(pageSize) => dispatch({ type: "pageSize", pageSize })}
        />
      </section>

      <PlatformToggles platforms={platforms} controlEnabled={Boolean(control?.enabled)} onToggle={onTogglePlatform} />
      <AddSourceForm onAdd={onAddSource} />
      <SourcesPanel
        sources={sources}
        platforms={platforms}
        controlEnabled={Boolean(control?.enabled)}
        scanNotes={state.scanNotes}
        onInterval={onSourceInterval}
        onToggle={onSourceToggle}
        onScan={onSourceScan}
        onDelete={onSourceDelete}
      />
      <BadClients names={control?.excluded_clients || []} onChange={onBadClients} />
    </div>
  );
}
