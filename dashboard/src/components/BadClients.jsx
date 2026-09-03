import { memo, useState } from "react";
import { splitClientNames, uniqueClientNames } from "../lib/jobs";

export const BadClients = memo(function BadClients({ names, onChange }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listed = uniqueClientNames(names);

  async function addNames(incoming) {
    const parsed = splitClientNames(Array.isArray(incoming) ? incoming.join("\n") : incoming);
    if (!parsed.length) return;
    const have = new Set(listed.map((n) => n.toLowerCase()));
    const extra = parsed.filter((n) => !have.has(n.toLowerCase()));
    setDraft("");
    if (!extra.length) return;
    setBusy(true);
    try {
      await onChange(uniqueClientNames([...listed, ...extra]));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    await addNames(draft);
  }

  function onPaste(e) {
    const text = e.clipboardData?.getData("text") || "";
    const parsed = splitClientNames(text);
    if (parsed.length < 2) return;
    e.preventDefault();
    addNames(parsed);
  }

  async function removeName(name) {
    setBusy(true);
    try {
      await onChange(listed.filter((n) => n !== name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Bad clients</h2>
      <p className="muted">
        Paste several client names at once. Separate them with a new line or a comma — you do not need
        Enter for each name. Duplicate names are skipped. New jobs whose client contains any of these
        names are stored as seen but never queued or sent to Discord.
      </p>
      <div className="inbox">
        <div className="chips">
          {listed.length === 0 && <p className="muted">No names yet. Paste a list below.</p>}
          {listed.map((name) => (
            <span className="chip" key={name.toLowerCase()}>
              {name}
              <button type="button" className="chip-x" disabled={busy} onClick={() => removeName(name)} aria-label={`Remove ${name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <form className="inbox-add" onSubmit={onSubmit}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={onPaste}
            placeholder={"NORTH inc.\nクラウドワークス テック\nAcme"}
            disabled={busy}
            rows={4}
          />
          <button type="submit" disabled={busy || splitClientNames(draft).length === 0}>
            Add
          </button>
        </form>
      </div>
    </section>
  );
});
