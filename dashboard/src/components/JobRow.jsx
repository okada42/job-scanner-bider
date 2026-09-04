import { memo } from "react";
import {
  LABELS,
  jobUserStates,
  sameJson,
  userStateAgeLabel,
  userStatePillClass,
} from "../lib/jobs";

function jobRowEqual(prev, next) {
  if (prev.reporting !== next.reporting || prev.onReport !== next.onReport) return false;
  const a = prev.job || {};
  const b = next.job || {};
  if (
    a.id !== b.id ||
    a.status !== b.status ||
    a.status_at !== b.status_at ||
    a.updated_at !== b.updated_at ||
    a.title !== b.title ||
    a.client !== b.client ||
    a.budget !== b.budget ||
    a.url !== b.url ||
    a.platform !== b.platform ||
    !sameJson(a.user_states, b.user_states) ||
    !sameJson(a.claims, b.claims)
  ) {
    return false;
  }
  const states = jobUserStates(b);
  return states.some((row) => row.state === "ready") ? prev.now === next.now : true;
}

export const JobRow = memo(function JobRow({ job, now, reporting, onReport }) {
  const states = jobUserStates(job);
  const age = userStateAgeLabel(states, now);
  return (
    <tr>
      <td>
        {states.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <div className="user-states">
            {states.map((row) => (
              <span key={row.actor || row.state} className={`pill ${userStatePillClass(row.state)}`}>
                {row.actor ? `${row.actor} ${row.state}` : row.state}
              </span>
            ))}
          </div>
        )}
        {age && <div className="status-age">{age}</div>}
      </td>
      <td>{LABELS[job.platform] || job.platform}</td>
      <td>
        {job.title || job.external_job_id}
        <div className="muted">{job.client}</div>
      </td>
      <td>{job.budget || "—"}</td>
      <td className="job-actions">
        {job.url ? (
          <a href={job.url} target="_blank" rel="noreferrer">
            Open
          </a>
        ) : (
          <span className="muted">—</span>
        )}
        <button
          type="button"
          className="report-btn"
          disabled={reporting || !String(job.client || "").trim()}
          onClick={() => onReport(job)}
        >
          {reporting ? "Reporting…" : "Report"}
        </button>
      </td>
    </tr>
  );
}, jobRowEqual);
