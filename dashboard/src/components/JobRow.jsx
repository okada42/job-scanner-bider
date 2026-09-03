import { memo } from "react";
import { AGE_STATUSES, LABELS, statusAgeLabel, statusPillClass } from "../lib/jobs";

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
    a.platform !== b.platform
  ) {
    return false;
  }
  return AGE_STATUSES.has(b.status) ? prev.now === next.now : true;
}

export const JobRow = memo(function JobRow({ job, now, reporting, onReport }) {
  const age = statusAgeLabel(job, now);
  return (
    <tr>
      <td>
        <span className={`pill ${statusPillClass(job.status)}`}>{job.status}</span>
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
