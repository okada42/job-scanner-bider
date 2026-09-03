import { memo } from "react";
import { useLiveClock } from "../lib/clock";
import { LABELS, needsClock, statusAgeLabel } from "../lib/jobs";

export const QueuePanel = memo(function QueuePanel({ current, queued, bider, onMode, onMaxActive }) {
  const now = useLiveClock(needsClock(current ? [current] : []));
  const age = current ? statusAgeLabel(current, now) : null;
  return (
    <article className="card">
      <h2>Bider</h2>
      {bider && (
        <div className="bider">
          <label>
            Mode
            <select value={bider.mode} onChange={(e) => onMode(e.target.value)}>
              <option value="auto">auto</option>
              <option value="semi-auto">semi-auto</option>
              <option value="paused">paused</option>
            </select>
          </label>
          <label>
            Max active
            <input type="number" defaultValue={bider.max_active_jobs} onBlur={(e) => onMaxActive(Number(e.target.value))} />
          </label>
        </div>
      )}
      <h3>CURRENT</h3>
      <p>
        {current ? `${current.platform} ${current.budget || ""} — ${current.title || current.url}` : "None"}
      </p>
      {age && (
        <p className="status-age">
          {current.status} {age}
        </p>
      )}
      <h3>QUEUE</h3>
      <ol>
        {(queued || []).slice(0, 8).map((j) => (
          <li key={j.id}>
            {LABELS[j.platform] || j.platform} {j.budget || ""} {j.title || j.external_job_id}
          </li>
        ))}
      </ol>
    </article>
  );
});
