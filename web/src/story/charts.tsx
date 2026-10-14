/**
 * Small SVG charts for the story. Specs follow the project's data-viz rules:
 * thin marks (bars ≤ 24px, 4px rounded data end, square at the baseline),
 * 2px surface gaps between touching fills, hairline solid axes, a legend for
 * every multi-series chart, sparing direct labels, text in text colours (never
 * the series colour), hover tooltips, and a data table for every chart.
 */
import { useMemo, useState, type ReactNode } from "react";
import { cssRGB, JB, NEUTRAL, RAMP, SG, type RGB } from "../lib/colors";
import { pct } from "../lib/format";
import "./charts.css";

export const CITY_COLOR: Record<"sg" | "jb", RGB> = { sg: SG, jb: JB };
export const CITY_NAME: Record<"sg" | "jb", string> = { sg: "Singapore", jb: "Johor Bahru" };

/** Bar with a 4px rounded data end and a square baseline, as an SVG path. */
function barPath(x0: number, x1: number, y: number, h: number, r = 4): string {
  const w = Math.max(0, x1 - x0);
  const rr = Math.min(r, w, h / 2);
  return `M${x0},${y} H${x0 + w - rr} Q${x0 + w},${y} ${x0 + w},${y + rr} V${y + h - rr} Q${x0 + w},${y + h} ${x0 + w - rr},${y + h} H${x0} Z`;
}

export function Legend({ items }: { items: { label: string; color: RGB; kind?: "dot" | "line" }[] }) {
  return (
    <div className="viz-legend" role="list">
      {items.map((it) => (
        <span key={it.label} role="listitem">
          <i className={it.kind === "line" ? "line" : "dot"} style={{ background: cssRGB(it.color) }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="viz-table">
      <summary>View data</summary>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const node = tip ? (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.body}
    </div>
  ) : null;
  return { setTip, node };
}

// --------------------------------------------------------------------------- city comparison bars

/** One horizontal bar per city (share of residents), value at the tip. */
export function CityBars({ values, caption, max = 1 }: { values: Record<"sg" | "jb", number>; caption: string; max?: number }) {
  const W = 420;
  const H = 2 * 34 + 8;
  const x0 = 92;
  const x1 = W - 52;
  const sx = (v: number) => x0 + (Math.max(0, v) / max) * (x1 - x0);
  const { setTip, node } = useTip();
  return (
    <figure className="viz">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        <line x1={x0} x2={x0} y1={4} y2={H - 4} className="axis" />
        {(["sg", "jb"] as const).map((c, i) => {
          const y = 10 + i * 34;
          return (
            <g key={c} onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 10, body: `${CITY_NAME[c]}: ${pct(values[c], 1)}` })} onMouseLeave={() => setTip(null)}>
              <rect x={0} y={y - 6} width={W} height={34} fill="transparent" />
              <text x={0} y={y + 13} className="lbl">
                {CITY_NAME[c]}
              </text>
              <path d={barPath(x0, sx(values[c]), y, 20)} fill={cssRGB(CITY_COLOR[c])} />
              <text x={sx(values[c]) + 8} y={y + 14} className="val">
                {pct(values[c])}
              </text>
            </g>
          );
        })}
      </svg>
      {node}
      <DataTable caption={caption} head={["City", "Share"]} rows={(["sg", "jb"] as const).map((c) => [CITY_NAME[c], pct(values[c], 1)])} />
    </figure>
  );
}

// --------------------------------------------------------------------------- stacked completeness

/** 100%-stacked bars of residents by number of essentials reachable (ordinal ramp, 2px gaps). */
export function CompletenessStack({ hist, caption, k = 6 }: { hist: Record<"sg" | "jb", number[]>; caption: string; k?: number }) {
  const W = 520;
  const rowH = 22;
  const gap = 2;
  const x0 = 92;
  const x1 = W - 8;
  const { setTip, node } = useTip();
  return (
    <figure className="viz">
      <svg viewBox={`0 0 ${W} ${2 * 44 + 26}`} role="img" aria-label={caption}>
        {(["sg", "jb"] as const).map((c, i) => {
          const y = 8 + i * 44;
          let acc = 0;
          const segs = hist[c].map((share, j) => {
            const a = x0 + acc * (x1 - x0);
            acc += share;
            const b = x0 + acc * (x1 - x0);
            return { j, a, b, share };
          });
          return (
            <g key={c}>
              <text x={0} y={y + 15} className="lbl">
                {CITY_NAME[c]}
              </text>
              {segs.map((s) =>
                s.b - s.a > 0.5 ? (
                  <rect
                    key={s.j}
                    x={s.a + (s.j > 0 ? gap / 2 : 0)}
                    y={y}
                    width={Math.max(0, s.b - s.a - (s.j > 0 ? gap / 2 : 0) - (s.j < k ? gap / 2 : 0))}
                    height={rowH}
                    rx={s.j === k ? 4 : 0}
                    fill={cssRGB(RAMP[s.j])}
                    onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 12, body: `${CITY_NAME[c]} · ${s.j} of ${k}: ${pct(s.share, 1)} of residents` })}
                    onMouseLeave={() => setTip(null)}
                  />
                ) : null,
              )}
              {segs[k].share > 0.08 ? (
                <text x={x1 - 6} y={y + 15} className="inbar" textAnchor="end" fill="#0b0e12">
                  {pct(segs[k].share)} all six
                </text>
              ) : null}
            </g>
          );
        })}
        <g transform={`translate(${x0}, ${2 * 44 + 12})`}>
          {RAMP.map((c, j) => (
            <g key={j} transform={`translate(${j * 34}, 0)`}>
              <rect width={26} height={8} rx={2} fill={cssRGB(c)} />
              <text x={13} y={20} textAnchor="middle" className="tick">
                {j}
              </text>
            </g>
          ))}
          <text x={7 * 34 + 6} y={8} className="tick">
            essentials within 15 min
          </text>
        </g>
      </svg>
      {node}
      <DataTable
        caption={caption}
        head={["Essentials reachable", "Singapore", "Johor Bahru"]}
        rows={Array.from({ length: k + 1 }, (_, j) => [`${j} of ${k}`, pct(hist.sg[j], 1), pct(hist.jb[j], 1)])}
      />
    </figure>
  );
}

// --------------------------------------------------------------------------- category dot plot

/** Dot plot: per essential, share of residents within the threshold, both cities. */
export function CategoryDots({ rows, caption }: { rows: { label: string; sg: number; jb: number }[]; caption: string }) {
  const W = 520;
  const rowH = 30;
  const x0 = 132;
  const x1 = W - 16;
  const sx = (v: number) => x0 + v * (x1 - x0);
  const H = rows.length * rowH + 30;
  const { setTip, node } = useTip();
  return (
    <figure className="viz">
      <Legend items={[{ label: "Singapore", color: SG }, { label: "Johor Bahru", color: JB }]} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={0} y2={rows.length * rowH} className="grid" />
            <text x={sx(t)} y={rows.length * rowH + 16} textAnchor="middle" className="tick">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = i * rowH + rowH / 2;
          return (
            <g key={r.label} onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 14, body: `${r.label}: Singapore ${pct(r.sg)}, Johor Bahru ${pct(r.jb)}` })} onMouseLeave={() => setTip(null)}>
              <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text x={0} y={y + 4} className="lbl">
                {r.label}
              </text>
              <line x1={sx(Math.min(r.sg, r.jb))} x2={sx(Math.max(r.sg, r.jb))} y1={y} y2={y} className="connector" />
              {(["jb", "sg"] as const).map((c) => (
                <circle key={c} cx={sx(r[c])} cy={y} r={5.5} fill={cssRGB(CITY_COLOR[c])} stroke="var(--ink-2)" strokeWidth={2} />
              ))}
            </g>
          );
        })}
      </svg>
      {node}
      <DataTable caption={caption} head={["Essential", "Singapore", "Johor Bahru"]} rows={rows.map((r) => [r.label, pct(r.sg, 1), pct(r.jb, 1)])} />
    </figure>
  );
}

// --------------------------------------------------------------------------- paired small multiples

/** Small multiples: one metric per row, its own scale, the two cities side by side. */
export function PairedMetrics({ rows, caption }: { rows: { label: string; unit: string; sg: number; jb: number; fmt?: (v: number) => string; note?: string }[]; caption: string }) {
  return (
    <figure className="viz paired">
      <Legend items={[{ label: "Singapore", color: SG }, { label: "Johor Bahru", color: JB }]} />
      <div className="pm-grid">
        {rows.map((r) => {
          const max = Math.max(r.sg, r.jb) * 1.15 || 1;
          const f = r.fmt ?? ((v: number) => v.toFixed(0));
          return (
            <div key={r.label} className="pm-row" title={r.note}>
              <div className="pm-label">
                {r.label} <span className="muted">{r.unit}</span>
              </div>
              {(["sg", "jb"] as const).map((c) => (
                <div key={c} className="pm-bar">
                  <svg viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden>
                    <path d={barPath(0, (r[c] / max) * 200, 1, 12, 3)} fill={cssRGB(CITY_COLOR[c])} />
                  </svg>
                  <span className="pm-val">{f(r[c])}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <DataTable caption={caption} head={["Indicator", "Singapore", "Johor Bahru"]} rows={rows.map((r) => [`${r.label} (${r.unit})`, (r.fmt ?? ((v: number) => v.toFixed(2)))(r.sg), (r.fmt ?? ((v: number) => v.toFixed(2)))(r.jb)])} />
    </figure>
  );
}

// --------------------------------------------------------------------------- cumulative curves

export interface Curve {
  key: string;
  label: string;
  color: RGB;
  /** sorted minutes with population weights */
  minutes: Float64Array;
  weights: Float64Array;
}

/** Share of a population reached within x minutes (one shared y-axis), with a crosshair. */
export function CumulativeChart({ curves, xMax = 150, caption, marks = [30, 45, 60, 90] }: { curves: Curve[]; xMax?: number; caption: string; marks?: number[] }) {
  const W = 540;
  const H = 260;
  const m = { l: 40, r: 16, t: 10, b: 30 };
  const sx = (v: number) => m.l + (Math.min(v, xMax) / xMax) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - v * (H - m.t - m.b);
  const paths = useMemo(
    () =>
      curves.map((c) => {
        const tot = c.weights.reduce((a, b) => a + b, 0);
        let acc = 0;
        const pts: [number, number][] = [[0, 0]];
        for (let i = 0; i < c.minutes.length; i++) {
          if (c.minutes[i] > xMax) break;
          acc += c.weights[i];
          if (i === c.minutes.length - 1 || c.minutes[i + 1] !== c.minutes[i]) pts.push([c.minutes[i], acc / tot]);
        }
        pts.push([xMax, pts[pts.length - 1][1]]);
        const step = Math.max(1, Math.floor(pts.length / 400));
        const d = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("");
        const at = (x: number) => {
          let a = 0;
          for (let i = 0; i < c.minutes.length && c.minutes[i] <= x; i++) a += c.weights[i];
          return a / tot;
        };
        return { ...c, d, at };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [curves, xMax],
  );
  const [hx, setHx] = useState<number | null>(null);
  return (
    <figure className="viz">
      <Legend items={curves.map((c) => ({ label: c.label, color: c.color, kind: "line" as const }))} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={caption}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          const v = ((x - m.l) / (W - m.l - m.r)) * xMax;
          setHx(v >= 0 && v <= xMax ? v : null);
        }}
        onMouseLeave={() => setHx(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 6} y={sy(t) + 4} textAnchor="end" className="tick">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {marks.map((t) => (
          <text key={t} x={sx(t)} y={H - 10} textAnchor="middle" className="tick">
            {t} min
          </text>
        ))}
        <line x1={m.l} x2={W - m.r} y1={sy(0)} y2={sy(0)} className="axis" />
        {paths.map((p) => (
          <path key={p.key} d={p.d} fill="none" stroke={cssRGB(p.color)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hx !== null ? (
          <g>
            <line x1={sx(hx)} x2={sx(hx)} y1={m.t} y2={H - m.b} className="crosshair" />
            {paths.map((p) => (
              <circle key={p.key} cx={sx(hx)} cy={sy(p.at(hx))} r={4} fill={cssRGB(p.color)} stroke="var(--ink-2)" strokeWidth={2} />
            ))}
          </g>
        ) : null}
      </svg>
      {hx !== null ? (
        <div className="viz-tip static">
          <b>{Math.round(hx)} min</b>
          {paths.map((p) => (
            <span key={p.key}>
              <i style={{ background: cssRGB(p.color) }} /> {p.label}: {pct(p.at(hx))}
            </span>
          ))}
        </div>
      ) : null}
      <DataTable caption={caption} head={["Within", ...curves.map((c) => c.label)]} rows={marks.map((t) => [`${t} min`, ...paths.map((p) => pct(p.at(t), 1))])} />
    </figure>
  );
}

// --------------------------------------------------------------------------- gain curve

export function GainCurve({ series, caption }: { series: { key: "sg" | "jb"; points: [number, number][] }[]; caption: string }) {
  const W = 520;
  const H = 220;
  const m = { l: 56, r: 16, t: 12, b: 30 };
  const xMax = Math.max(...series.flatMap((s) => s.points.map((p) => p[0])), 1);
  const yMax = Math.max(...series.flatMap((s) => s.points.map((p) => p[1])), 1) * 1.1;
  const sx = (v: number) => m.l + (v / xMax) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b);
  const ticks = [0, yMax / 3, (2 * yMax) / 3, yMax].map((v) => Math.round(v / 1000) * 1000);
  return (
    <figure className="viz">
      <Legend items={series.map((s) => ({ label: CITY_NAME[s.key], color: CITY_COLOR[s.key], kind: "line" as const }))} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 6} y={sy(t) + 4} textAnchor="end" className="tick">
              {t >= 1000 ? `${Math.round(t / 1000)}K` : t}
            </text>
          </g>
        ))}
        {[0, 10, 25, 50].filter((x) => x <= xMax).map((x) => (
          <text key={x} x={sx(x)} y={H - 10} textAnchor="middle" className="tick">
            {x} hubs
          </text>
        ))}
        <line x1={m.l} x2={W - m.r} y1={sy(0)} y2={sy(0)} className="axis" />
        {series.map((s) => (
          <g key={s.key}>
            <path
              d={s.points.map(([x, y], i) => `${i ? "L" : "M"}${sx(x)},${sy(y)}`).join("")}
              fill="none"
              stroke={cssRGB(CITY_COLOR[s.key])}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {s.points.length ? (
              <circle cx={sx(s.points[s.points.length - 1][0])} cy={sy(s.points[s.points.length - 1][1])} r={4} fill={cssRGB(CITY_COLOR[s.key])} stroke="var(--ink-2)" strokeWidth={2} />
            ) : null}
          </g>
        ))}
      </svg>
      <DataTable
        caption={caption}
        head={["Hubs", ...series.map((s) => CITY_NAME[s.key])]}
        rows={[10, 25, 50].map((n) => [String(n), ...series.map((s) => Math.round(s.points.find((p) => p[0] === n)?.[1] ?? NaN).toLocaleString())])}
      />
    </figure>
  );
}

export const NEUTRAL_RGB = NEUTRAL;
