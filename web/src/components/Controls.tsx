import type { ReactNode } from "react";
import "./controls.css";

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={`segmented ${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden>
        <span className="thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export type Evidence = "observed" | "calculated" | "modelled" | "assumed" | "scenario";

export function Badge({ kind, children }: { kind: Evidence; children?: ReactNode }) {
  return (
    <span className="badge" data-kind={kind} title={EVIDENCE_HELP[kind]}>
      {children ?? kind}
    </span>
  );
}

export const EVIDENCE_HELP: Record<Evidence, string> = {
  observed: "Measured or recorded data: OSM features, census counts, published timetables",
  calculated: "Computed directly from observed data with a documented method (e.g. network distances)",
  modelled: "Estimated by a model, e.g. gridded population allocated within census units",
  assumed: "A parameter chosen by this project and varied in the sensitivity analysis",
  scenario: "A hypothetical intervention — not a prediction",
};
