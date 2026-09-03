import { memo } from "react";
import { useLiveClock } from "../lib/clock";
import { LABELS, needsClock, statusAgeLabel } from "../lib/jobs";

export const QueuePanel = memo(function QueuePanel({ current, active, queued, bider, onMode, onMaxActive }) {
  const list = active?.length ? active : current ? [current] : [];
  const now = useLiveClock(needsClock(list));
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
            <input
              type="number"
              min="1"
              max="10"
              defaultValue={bider.max_active_jobs}
              onBlur={(e) => onMaxActive(Number(e.target.value))}
            />
          </label>
          <p className="muted">
            The Chrome apply profile keeps this many job tabs open and opens the next queued URL after you submit.
          </p>
        </div>
      )}
      <h3>CURRENT</h3>
      {list.length === 0 ? (
        <p>None</p>
      ) : (
        list.map((job) => {
          const age = statusAgeLabel(job, now);
          return (
            <div key={job.id}>
              <p>
                {job.platform} {job.budget || ""} — {job.title || job.url}
              </p>
              {age && (
                <p className="status-age">
                  {job.status} {age}
                </p>
              )}
            </div>
          );
        })
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
