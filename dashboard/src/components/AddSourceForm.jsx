import { memo, useState } from "react";
import { LABELS, PLATFORMS } from "../lib/jobs";

const EMPTY = {
  platform: "crowdworks",
  url: "",
  name: "",
  scan_interval: 60,
  minimum_budget: "",
  maximum_applications: "",
  keywords: "",
};

export const AddSourceForm = memo(function AddSourceForm({ onAdd }) {
  const [form, setForm] = useState(EMPTY);
  return (
    <section className="card">
      <h2>Add monitored URL</h2>
      <form
        className="add"
        onSubmit={async (e) => {
          e.preventDefault();
          const rules = {
            minimum_budget: form.minimum_budget ? Number(form.minimum_budget) : null,
            maximum_applications: form.maximum_applications ? Number(form.maximum_applications) : null,
            keywords: form.keywords
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
          await onAdd({
            platform: form.platform,
            url: form.url,
            name: form.name || null,
            scan_interval: Number(form.scan_interval) || 60,
            rules,
          });
          setForm({ ...form, url: "", name: "" });
        }}
      >
        <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {LABELS[p]}
            </option>
          ))}
        </select>
        <input
          placeholder="Search results URL (not a single job page)"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          required
        />
        <input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>
          Interval (sec)
          <input
            type="number"
            min="5"
            value={form.scan_interval}
            onChange={(e) => setForm({ ...form, scan_interval: e.target.value })}
          />
        </label>
        <input
          placeholder="Min budget"
          value={form.minimum_budget}
          onChange={(e) => setForm({ ...form, minimum_budget: e.target.value })}
        />
        <input
          placeholder="Max applications"
          value={form.maximum_applications}
          onChange={(e) => setForm({ ...form, maximum_applications: e.target.value })}
        />
        <input
          placeholder="Keywords, comma separated"
          value={form.keywords}
          onChange={(e) => setForm({ ...form, keywords: e.target.value })}
        />
        <button type="submit">Add source</button>
      </form>
    </section>
  );
});
