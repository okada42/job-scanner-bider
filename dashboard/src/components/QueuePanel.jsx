import { memo, useState } from "react";

export const QueuePanel = memo(function QueuePanel({ bider, busy, note, onMode, onMaxActive, onAddUrls }) {
  const [draft, setDraft] = useState("");
  const lines = draft
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  async function onSubmit(e) {
    e.preventDefault();
    if (!lines.length || busy) return;
    const ok = await onAddUrls(draft);
    if (ok) setDraft("");
  }

  return (
    <article className="card">
      <h2>Bider</h2>
      {bider && (
        <form className="bider-bar" onSubmit={onSubmit}>
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
          <label className="bider-inbox">
            Job URLs
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={"https://crowdworks.jp/public/jobs/13391751\nhttps://www.lancers.jp/work/detail/42"}
              rows={3}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy || lines.length === 0}>
            {busy ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      <p className="muted">
        Max active is the normal window. URLs pasted here open immediately as extra tabs and stay at the
        front of the queue. One job URL per line. No Discord.
      </p>
      {note ? <p className={note.ok ? "scan-note" : "err small"}>{note.text}</p> : null}
    </article>
  );
});
