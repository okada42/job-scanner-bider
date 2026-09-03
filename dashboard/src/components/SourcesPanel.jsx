import { memo } from "react";
import { LABELS } from "../lib/jobs";

export const SourcesPanel = memo(function SourcesPanel({
  sources,
  platforms,
  controlEnabled,
  scanNotes,
  onInterval,
  onToggle,
  onScan,
  onDelete,
}) {
  return (
    <section className="card">
      <h2>Sources</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Platform</th>
              <th>Interval</th>
              <th>Last scan</th>
              <th>
                Found
                <div className="muted">today</div>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  No sources yet. Paste a search-results URL above.
                </td>
              </tr>
            ) : (
              sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className={`dot ${s.enabled && platforms[s.platform] && controlEnabled ? "on" : "off"}`} />
                  </td>
                  <td>
                    <div>{s.name || LABELS[s.platform]}</div>
                    <a className="url" href={s.url} target="_blank" rel="noreferrer">
                      {s.url}
                    </a>
                    {s.last_error && <div className="err small">{s.last_error}</div>}
                    {scanNotes[s.id] && (
                      <div className="scan-note">
                        Last scan: found {scanNotes[s.id].found ?? 0}, stored {scanNotes[s.id].created ?? 0}
                        {scanNotes[s.id].baselined ? `, baseline ${scanNotes[s.id].baselined}` : ""}
                        {scanNotes[s.id].queued ? `, queued ${scanNotes[s.id].queued}` : ""}
                        {scanNotes[s.id].discorded ? `, discord ${scanNotes[s.id].discorded}` : ""}
                        {scanNotes[s.id].sample?.length
                          ? ` — ${scanNotes[s.id].sample
                              .map((j) => j.title || j.id)
                              .filter(Boolean)
                              .slice(0, 3)
                              .join(" · ")}`
                          : ""}
                      </div>
                    )}
                  </td>
                  <td>{LABELS[s.platform]}</td>
                  <td>
                    <input
                      className="narrow"
                      type="number"
                      min="5"
                      defaultValue={s.scan_interval}
                      onBlur={(e) => onInterval(s, Number(e.target.value))}
                    />
                    <span className="muted"> sec</span>
                  </td>
                  <td>{s.last_scanned_at ? new Date(s.last_scanned_at).toLocaleTimeString() : "—"}</td>
                  <td>
                    <div>{s.found ?? s.last_job_count ?? s.job_count ?? 0}</div>
                    {s.listing_total ? (
                      <div className="muted">{Number(s.listing_total).toLocaleString()} listed</div>
                    ) : null}
                  </td>
                  <td className="actions">
                    <button type="button" onClick={() => onToggle(s)}>
                      {s.enabled ? "Disable" : "Enable"}
                    </button>
                    <button type="button" onClick={() => onScan(s)}>
                      Scan
                    </button>
                    <button type="button" className="danger" onClick={() => onDelete(s)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
});
