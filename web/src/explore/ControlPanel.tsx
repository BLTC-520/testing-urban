import { useEffect, useMemo, useState } from "react";
import { Badge, Field, Segmented, Switch } from "../components/Controls";
import { CATEGORY_COLOR, cssRGB } from "../lib/colors";
import { loadNeighbourhoods } from "../lib/data";
import { pct } from "../lib/format";
import { href } from "../lib/router";
import { isNonBaseline, useExplorer, type MetricId, type ScenarioId } from "../lib/store";
import type { CityId, Meta, Summary } from "../lib/types";
import type { Surface } from "./useSurface";

export function ControlPanel({
  meta,
  surfaces,
  onFly,
}: {
  meta: Meta;
  summary: Summary | null;
  surfaces: Partial<Record<CityId, Surface>>;
  onFly: (center: [number, number], zoom: number, unitId?: string) => void;
}) {
  const s = useExplorer();
  const [units, setUnits] = useState<{ id: string; name: string; city: CityId; center: [number, number] }[]>([]);
  const [showAssumptions, setShowAssumptions] = useState(false);

  useEffect(() => {
    loadNeighbourhoods().then((fc) => {
      const list = fc.features.map((f) => {
        const coords: number[][] = [];
        const walk = (c: unknown) => {
          if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as number[]);
          else if (Array.isArray(c)) c.forEach(walk);
        };
        walk((f.geometry as GeoJSON.Polygon).coordinates);
        const xs = coords.map((c) => c[0]);
        const ys = coords.map((c) => c[1]);
        return {
          id: String(f.properties?.unit_id),
          name: String(f.properties?.unit_name),
          city: f.properties?.city as CityId,
          center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] as [number, number],
        };
      });
      list.sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
      setUnits(list);
    });
  }, []);

  const cats = meta.categories.filter((c) => c.basket);
  const supp = meta.categories.filter((c) => c.id === "rapid_transit" || c.id === "civic");
  const metricOptions: { id: MetricId; label: string; color?: string }[] = [
    { id: "complete", label: "All six essentials" },
    ...cats.map((c) => ({ id: c.id as MetricId, label: c.label, color: cssRGB(CATEGORY_COLOR[c.id]) })),
    ...supp.map((c) => ({ id: c.id as MetricId, label: c.label, color: cssRGB(CATEGORY_COLOR[c.id]) })),
  ];
  const nonBaseline = isNonBaseline(s);
  const speeds = meta.accessibility.walk_speed_mps;

  const stat = useMemo(() => {
    const out: Partial<Record<CityId, number>> = {};
    for (const c of ["sg", "jb"] as CityId[]) {
      const sfc = surfaces[c];
      if (!sfc) continue;
      if (sfc.shares) out[c] = sfc.shares.complete;
      else {
        // share of people within the threshold of this category
        let tot = 0;
        let ok = 0;
        for (let i = 0; i < sfc.cells.n; i++) {
          const v = sfc.value[i];
          if (Number.isNaN(v)) continue;
          tot += sfc.weights[i];
          if (v <= s.threshold) ok += sfc.weights[i];
        }
        out[c] = tot ? ok / tot : NaN;
      }
    }
    return out;
  }, [surfaces, s.threshold]);

  const metricLabel = metricOptions.find((m) => m.id === s.metric)?.label ?? "";
  const who = s.people === "elderly" ? "residents aged 65+" : "residents";

  return (
    <div className="panel-inner">
      <div className="panel-intro">
        <p className="eyebrow">Explorer</p>
        <h1>What can people reach on foot?</h1>
      </div>

      <div className="panel-stats" aria-live="polite">
        {(["sg", "jb"] as CityId[]).map((c) => (
          <div key={c} className={`pstat ${c}`}>
            <div className="pstat-head">
              <span className="pstat-city">{meta.cities[c].name}</span>
              <span className="pstat-value">{pct(stat[c])}</span>
            </div>
            <div className="pstat-bar">
              <span style={{ width: `${Math.max(0, Math.min(1, stat[c] ?? 0)) * 100}%` }} />
            </div>
          </div>
        ))}
        <p className="pstat-caption">
          Share of {who} who can reach {s.metric === "complete" ? "all six essentials" : metricLabel.toLowerCase()} within{" "}
          {s.threshold} min at {speeds[s.speed]} m/s{s.scenario !== "none" ? " — with the scenario applied" : ""}.
        </p>
      </div>

      <Field label="Show">
        <div className="metric-list" role="radiogroup" aria-label="Metric">
          {metricOptions.map((m) => (
            <button key={m.id} role="radio" aria-checked={s.metric === m.id} className={s.metric === m.id ? "on" : ""} onClick={() => s.set({ metric: m.id })}>
              <span className="swatch" style={{ background: m.color ?? "linear-gradient(90deg,var(--ramp-1),var(--ramp-4),var(--ramp-6))" }} />
              {m.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Within" hint={s.metric === "complete" ? "walking time" : "used for the shares above"}>
        <Segmented
          label="Time threshold"
          value={s.threshold}
          options={meta.accessibility.thresholds_min.map((t) => ({ value: t, label: `${t} min` }))}
          onChange={(v) => s.set({ threshold: v })}
        />
      </Field>

      <Field label="Walking speed">
        <Segmented
          label="Walking speed"
          value={s.speed}
          options={[
            { value: "slow", label: `${speeds.slow} m/s`, title: "Slower pace, e.g. many older adults" },
            { value: "base", label: `${speeds.base} m/s`, title: "Typical planning value" },
            { value: "brisk", label: `${speeds.brisk} m/s`, title: "Brisk adult pace" },
          ]}
          onChange={(v) => s.set({ speed: v })}
        />
      </Field>

      <Field label="People">
        <Segmented
          label="Population group"
          value={s.people}
          options={[
            { value: "all", label: "All residents" },
            { value: "elderly", label: "Aged 65+" },
          ]}
          onChange={(v) => s.set({ people: v })}
        />
      </Field>

      <div className="drawer">
        <button className="drawer-head" onClick={() => setShowAssumptions((v) => !v)} aria-expanded={showAssumptions}>
          <span>Assumptions</span>
          {nonBaseline ? <Badge kind="assumed">changed</Badge> : <span className="muted small">baseline</span>}
          <span className="chev" aria-hidden>
            {showAssumptions ? "–" : "+"}
          </span>
        </button>
        {showAssumptions ? (
          <div className="drawer-body">
            <Field label="What counts as an essential">
              <Segmented
                size="sm"
                label="Taxonomy variant"
                value={s.taxonomy}
                options={[
                  { value: "strict", label: "Strict" },
                  { value: "core", label: "Core" },
                  { value: "broad", label: "Broad" },
                ]}
                onChange={(v) => s.set({ taxonomy: v, network: "permissive", poiSource: "osm" })}
              />
            </Field>
            <Field label="Street network" hint="arterials">
              <Segmented
                size="sm"
                label="Network variant"
                value={s.network}
                options={[
                  { value: "permissive", label: "All walkable" },
                  { value: "strict", label: "Need sidewalk" },
                ]}
                onChange={(v) => s.set({ network: v, taxonomy: "core", poiSource: "osm" })}
              />
            </Field>
            <Field label="Destinations from">
              <Segmented
                size="sm"
                label="POI source"
                value={s.poiSource}
                options={[
                  { value: "osm", label: "OpenStreetMap" },
                  { value: "overture", label: "Overture Places" },
                ]}
                onChange={(v) => s.set({ poiSource: v, taxonomy: "core", network: "permissive" })}
              />
            </Field>
            <p className="small muted">
              One assumption is varied at a time against the baseline. The full grid of {""}
              combinations is summarised in the robustness table on the <a href={href("/methods", undefined, "sensitivity")}>Methods</a> page.
            </p>
          </div>
        ) : null}
      </div>

      <Field label="Scenario · Parking to Proximity" hint={<Badge kind="scenario" />}>
        <Segmented
          label="Parking to Proximity hubs"
          value={s.scenario}
          options={[
            { value: "none", label: "Today" },
            ...meta.parking_to_proximity.sites_per_city.map((n) => ({ value: `p2p${n}` as ScenarioId, label: `${n} hubs` })),
          ]}
          onChange={(v) => s.set({ scenario: v })}
        />
        <p className="small muted">
          Converts mapped car parks into neighbourhood service hubs at the sites that close the most 15-minute gaps. A
          what-if, not a forecast.
        </p>
      </Field>

      <Field label="Layers">
        <div className="switches">
          <Switch label="Neighbourhood outlines" checked={s.showUnits} onChange={(v) => s.set({ showUnits: v })} />
          <Switch label="Destinations (zoom in)" checked={s.showPois} onChange={(v) => s.set({ showPois: v })} />
        </div>
      </Field>

      <Field label="Jump to">
        <select
          className="select"
          aria-label="Jump to a neighbourhood"
          defaultValue=""
          onChange={(e) => {
            const u = units.find((x) => x.id === e.target.value);
            if (u) onFly(u.center, 13, u.id);
          }}
        >
          <option value="" disabled>
            A neighbourhood…
          </option>
          {(["sg", "jb"] as CityId[]).map((c) => (
            <optgroup key={c} label={meta.cities[c].name}>
              {units
                .filter((u) => u.city === c)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </Field>

      <p className="panel-foot small muted">
        OpenStreetMap snapshot {meta.osm_snapshot} · Census 2020 (SingStat, DOSM) · HRSL population ·{" "}
        <a href={href("/methods")}>how this is calculated</a>
      </p>
    </div>
  );
}
