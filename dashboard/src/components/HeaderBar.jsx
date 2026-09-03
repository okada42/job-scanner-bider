import { memo } from "react";

export const HeaderBar = memo(function HeaderBar({ control, updating, loaded, onToggleAll }) {
  return (
    <header>
      <div>
        <h1>JOB SCANNER</h1>
        <p className="muted">
          Add a search-results URL. The first crawl stores every listing already on that page as seen
          (no Discord, no queue). Later crawls only queue jobs that were never stored before.
        </p>
        <p className="muted">
          The backend fetches the URL on each interval. Login-walled pages still need the Chrome
          extension on a logged-in search profile; an anonymous GET cannot see those jobs.
        </p>
      </div>
      <div className="overall">
        {loaded && updating ? <span className="updating">Updating…</span> : null}
        <span className={`dot ${control?.enabled ? "on" : "off"}`} />
        Overall: {control?.enabled ? "RUNNING" : "STOPPED"}
        <button type="button" onClick={onToggleAll}>
          {control?.enabled ? "STOP ALL" : "START ALL"}
        </button>
      </div>
    </header>
  );
});
