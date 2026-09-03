import { memo } from "react";

export const QueuePanel = memo(function QueuePanel({ bider, onMode, onMaxActive }) {
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
    </article>
  );
});
