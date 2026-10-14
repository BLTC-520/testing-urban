import { latLngToCell } from "h3-js";
import { useMemo } from "react";
import { Badge } from "../components/Controls";
import { CATEGORY_COLOR, cssRGB } from "../lib/colors";
import { minutes as fmtMin, pct, people } from "../lib/format";
import { useExplorer } from "../lib/store";
import type { CityId, Meta, Summary } from "../lib/types";
import type { IsoState } from "./useIsochrone";
import type { Surface } from "./useSurface";

export function Inspector({
  meta,
  summary,
  iso,
  threshold,
  speed,
  onClose,
  surfaces,
  unitIds,
}: {
  meta: Meta | null;
  summary: Summary | null;
  iso: IsoState;
  threshold: number;
  speed: number;
  onClose: () => void;
  surfaces: Partial<Record<CityId, Surface>>;
  /** neighbourhood id by feature index (the cells' `unit` column) */
  unitIds: string[];
}) {
  const sel = useExplorer((s) => s.selection);
  const city = sel?.city ?? null;

  // the analysis cell under the click (population, neighbourhood)
  const cell = useMemo(() => {
    if (!sel || !city) return null;
    const sfc = surfaces[city];
    if (!sfc) return null;
    const h = latLngToCell(sel.lat, sel.lon, 10);
    const i = sfc.cells.h3.indexOf(h);
    return i >= 0 ? { i, pop: sfc.cells.pop[i], unit: sfc.cells.unit[i] } : null;
  }, [sel, city, surfaces]);

  const unit = useMemo(() => {
    if (!summary || !cell || !city) return null;
    // unit index → neighbourhood record (order of neighbourhoods.geojson features)
    const id = unitIds[cell.unit];
    return summary.neighbourhoods.find((n) => n.unit_id === id) ?? null;
  }, [summary, cell, city, unitIds]);

  if (!meta || !sel) return null;
  const basket = meta.categories.filter((c) => c.basket);
  const reached = iso.reached;
  const within = reached ? basket.filter((c) => (reached.nearest[c.id]?.minutes ?? Infinity) <= threshold).length : null;
  const citySummary = city && summary ? summary.cities[city].all : null;

  return (
    <aside className="inspector" aria-label="Selected location">
      <div className="insp-head">
        <div>
          <p className="eyebrow">{city ? meta.cities[city].name : "Outside the study area"}</p>
          <h2>{unit?.unit_name ?? (city ? "Selected spot" : "No data here")}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {!city ? <p className="muted">Click on land within Singapore or the Johor Bahru study area.</p> : null}
      {city && iso.status === "loading" ? <p className="muted">Walking the street network…</p> : null}
      {city && iso.status === "offnetwork" ? <p className="muted">This spot is more than 400 m from any walkable street.</p> : null}
      {city && iso.status === "error" ? <p className="muted">Could not load the street network for this area.</p> : null}

      {reached ? (
        <>
          <div className="verdict">
            <span className="big">{within}</span>
            <span>
              of 6 essentials within <b>{threshold} min</b> on foot
              <br />
              <span className="muted small">
                at {speed} m/s · <Badge kind="calculated">network</Badge>
              </span>
            </span>
          </div>
          <ul className="reach-list">
            {basket.map((c) => {
              const n = reached.nearest[c.id];
              const ok = (n?.minutes ?? Infinity) <= threshold;
              return (
                <li key={c.id} className={ok ? "ok" : "no"}>
                  <span className="dot" style={{ background: cssRGB(CATEGORY_COLOR[c.id]) }} />
                  <span className="cat">
                    <b>{c.label}</b>
                    <span className="muted small">{n ? n.name || c.short : "none within 20 min"}</span>
                  </span>
                  <span className="mins num">{n ? fmtMin(n.minutes) : "> 20 min"}</span>
                  <span className="mark" aria-label={ok ? "within threshold" : "beyond threshold"}>
                    {ok ? "✓" : "✕"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="small muted">
            {reached.counts.dining ?? 0} eateries, {reached.counts.transit ?? 0} stops and {reached.counts.healthcare ?? 0} clinics or
            pharmacies are within {threshold} min.
          </p>
        </>
      ) : null}

      {unit && citySummary ? (
        <div className="insp-context">
          <div className="ctx-row">
            <span>{unit.unit_name}</span>
            <span className="num">{pct(unit.share_complete)}</span>
          </div>
          <div className="ctx-bar">
            <span style={{ width: `${unit.share_complete * 100}%` }} />
          </div>
          <div className="ctx-row muted">
            <span>{meta.cities[city!].name} overall</span>
            <span className="num">{pct(citySummary.share_complete)}</span>
          </div>
          <div className="ctx-bar city">
            <span style={{ width: `${citySummary.share_complete * 100}%` }} />
          </div>
          <p className="small muted">
            Share of residents with all six essentials within 15 min (baseline). {people(unit.population)} residents; weakest category:{" "}
            {meta.categories.find((c) => c.id === unit.weakest_category)?.label.toLowerCase()} ({pct(unit.weakest_share)} within reach).
          </p>
        </div>
      ) : null}
      {cell && cell.pop >= 1 ? (
        <p className="small muted">
          This 66 m hexagon: ~{Math.round(cell.pop)} residents <Badge kind="modelled">modelled</Badge>
        </p>
      ) : null}
    </aside>
  );
}
