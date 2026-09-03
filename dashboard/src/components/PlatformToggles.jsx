import { memo } from "react";
import { LABELS, PLATFORMS } from "../lib/jobs";

export const PlatformToggles = memo(function PlatformToggles({ platforms, controlEnabled, onToggle }) {
  return (
    <section className="grid3">
      {PLATFORMS.map((p) => (
        <article key={p} className="card">
          <div className="row">
            <strong>{LABELS[p]}</strong>
            <span className={`pill ${platforms[p] && controlEnabled ? "on" : "off"}`}>
              {platforms[p] && controlEnabled ? "ON" : "OFF"}
            </span>
          </div>
          <button type="button" onClick={() => onToggle(p, Boolean(platforms[p]))}>
            {platforms[p] ? "STOP" : "START"}
          </button>
        </article>
      ))}
    </section>
  );
});
