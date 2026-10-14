import { useMemo, useState, type ReactNode } from "react";
import { int, pct } from "../lib/format";
import type { MetricId } from "../lib/store";
import type { CityId, Meta, Summary } from "../lib/types";
import { networkMask, reachesAll, reachesWithin, unitStats, type CitySlice } from "../lib/unitStats";
import type { Surface } from "./useSurface";

/**
 * The Explorer's table view: one row per neighbourhood with the share of its
 * residents who reach the selected metric. It carries the map's numbers in
 * text, so it works in browsers without WebGL.
 */

const CITY: Record<CityId, string> = { sg: "Singapore", jb: "Johor Bahru" };

type SortKey = "share" | "residents";
interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

interface Row {
  id: string;
  name: string;
  city: CityId;
  residents: number;
  onNetwork: number;
  reached: number;
  share: number;
}

export function NeighbourhoodTable({
  summary,
  meta,
  unitIds,
  surfaces,
  metric,
  threshold,
  people,
  speed,
  panelOpen,
  inspecting,
  notice,
}: {
  summary: Summary | null;
  meta: Meta | null;
  /** neighbourhood id by feature index (the cells' `unit` column) */
  unitIds: string[];
  surfaces: Partial<Record<CityId, Surface>>;
  metric: MetricId;
  threshold: number;
  people: "all" | "elderly";
  /** metres per second */
  speed: number;
  /** the controls panel covers the left of the page */
  panelOpen: boolean;
  /** an inspector covers the right of the page */
  inspecting: boolean;
  notice?: ReactNode;
}) {
  // lowest share first, as the page opens
  const [sort, setSort] = useState<Sort>({ key: "share", dir: "asc" });

  const rows = useMemo<Row[]>(() => {
    if (!summary || !meta) return [];
    const idOf = new Map<string, number>();
    unitIds.forEach((id, i) => idOf.set(id, i));
    const slices: CitySlice[] = [];
    for (const sfc of Object.values(surfaces)) {
      if (!sfc) continue;
      slices.push({ unit: sfc.cells.unit, weights: sfc.weights, value: sfc.value, network: networkMask(sfc.d, meta.basket, sfc.cells.n) });
    }
    const stats = unitStats(slices, metric === "complete" ? reachesAll(meta.basket.length) : reachesWithin(threshold));
    return summary.neighbourhoods.map((n) => {
      const st = stats.get(idOf.get(n.unit_id) ?? -1);
      return {
        id: n.unit_id,
        name: n.unit_name,
        city: n.city,
        residents: st?.residents ?? 0,
        onNetwork: st?.onNetwork ?? 0,
        reached: st?.reached ?? 0,
        share: st?.share ?? NaN,
      };
    });
  }, [summary, meta, unitIds, surfaces, metric, threshold]);

  const sorted = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    const value = (r: Row) => (sort.key === "share" ? r.share : r.residents);
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      // neighbourhoods without a share go last, whichever way the table runs
      if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1;
      return (Number.isNaN(x) ? 0 : (x - y) * sign) || a.name.localeCompare(b.name);
    });
  }, [rows, sort]);

  const sortBy = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "share" ? "asc" : "desc" }));

  const reach = metric === "complete" ? "all six essentials" : (meta?.categories.find((c) => c.id === metric)?.label ?? "").toLowerCase();
  const who = people === "elderly" ? "residents aged 65+" : "residents";
  const loading = !summary || !meta || Object.keys(surfaces).length === 0;

  return (
    <section className={`neighbourhood-view${panelOpen ? " panel-open" : ""}${inspecting ? " inspecting" : ""}`} aria-label="Neighbourhood table">
      {notice}
      {loading ? (
        <p className="muted" aria-live="polite">
          Loading the neighbourhood figures…
        </p>
      ) : (
        <>
          <p className="table-intro">
            Share of {who} who can reach {reach} within {threshold} min at {speed} m/s. Each share counts residents whose street cell joins the walking network; cells
            with no data are left out.
          </p>
          <div className="table-wrap">
            <table className="neighbourhood-table">
              <caption className="visually-hidden">Neighbourhoods, sorted by the share of residents who can reach {reach}</caption>
              <thead>
                <tr>
                  <th scope="col">Neighbourhood</th>
                  <th scope="col" className="city-col">
                    City
                  </th>
                  <SortHeader label="Residents" k="residents" sort={sort} onSort={sortBy} />
                  <SortHeader label="Share" k="share" sort={sort} onSort={sortBy} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      {r.name}
                      {/* on a phone the city has no column of its own, so it sits under the name */}
                      <span className="city-inline">{CITY[r.city]}</span>
                    </th>
                    <td className="city-col">
                      <span className={`city-name ${r.city}`}>{CITY[r.city]}</span>
                    </td>
                    <td className="num">{int(r.residents)}</td>
                    <td className="share-cell" title={`${int(r.reached)} of ${int(r.onNetwork)} residents on the walking network`}>
                      <span className="share-bar" aria-hidden="true">
                        <span style={{ width: `${Number.isNaN(r.share) ? 0 : r.share * 100}%` }} />
                      </span>
                      <span className="num share-value">{pct(r.share)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function SortHeader({ label, k, sort, onSort }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void }) {
  const active = sort.key === k;
  return (
    <th scope="col" className="num" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sort-btn" onClick={() => onSort(k)}>
        {label}
        <span className="sort-mark" aria-hidden="true">
          {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}
