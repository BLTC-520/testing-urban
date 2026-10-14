/**
 * Small SVG charts for the story. Specs follow the project's data-viz rules:
 * thin marks (bars ≤ 24px, 4px rounded data end, square at the baseline),
 * 2px surface gaps between touching fills, hairline solid axes, a legend for
 * every multi-series chart, sparing direct labels, text in text colours (never
 * the series colour), hover tooltips, and a data table for every chart.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cssRGB, JB, NEUTRAL, RAMP, SG, type RGB } from "../lib/colors";
import { pct } from "../lib/format";
import "./charts.css";


/** Draw charts at their real pixel width (text never scales with the container). */
function useWidth(min = 280, fallback = 560): [React.RefObject<HTMLElement | null>, number] {
  const ref = useRef<HTMLElement | null>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (cw: number) => cw > 0 && setW(Math.max(min, Math.round(cw)));
    measure(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((es) => measure(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w];
}

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
  const [ref, W] = useWidth();
  const H = 2 * 34 + 8;
  const x0 = 92;
  const x1 = W - 52;
  const sx = (v: number) => x0 + (Math.max(0, v) / max) * (x1 - x0);
  const { setTip, node } = useTip();
  return (
    <figure className="viz" ref={ref}>
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
  const [ref, W] = useWidth();
  const rowH = 22;
  const gap = 2;
  const x0 = 92;
  const x1 = W - 92;
  const { setTip, node } = useTip();
  return (
    <figure className="viz" ref={ref}>
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
              <text x={x1 + 10} y={y + 15} className="val">
                {pct(segs[k].share)} <tspan className="muted-svg">all six</tspan>
              </text>
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
  const [ref, W] = useWidth();
  const rowH = 30;
  const x0 = 132;
  const x1 = W - 16;
  const sx = (v: number) => x0 + v * (x1 - x0);
  const H = rows.length * rowH + 30;
  const { setTip, node } = useTip();
  return (
    <figure className="viz" ref={ref}>
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
  const [ref, W] = useWidth();
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
    <figure className="viz" ref={ref}>
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
  const [ref, W] = useWidth();
  const H = 220;
  const m = { l: 56, r: 16, t: 12, b: 30 };
  const xMax = Math.max(...series.flatMap((s) => s.points.map((p) => p[0])), 1);
  const yMax = Math.max(...series.flatMap((s) => s.points.map((p) => p[1])), 1) * 1.1;
  const sx = (v: number) => m.l + (v / xMax) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b);
  const ticks = [0, yMax / 3, (2 * yMax) / 3, yMax].map((v) => Math.round(v / 1000) * 1000);
  return (
    <figure className="viz" ref={ref}>
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

// --------------------------------------------------------------------------- threshold line chart

/** Share reaching all essentials as the time budget changes: one line per city, shared axis. */
export function ThresholdChart({ data, caption }: { data: Record<"sg" | "jb", Record<string, number>>; caption: string }) {
  const [ref, W] = useWidth();
  const H = 230;
  const m = { l: 40, r: 70, t: 12, b: 30 };
  const xs = Object.keys(data.sg).map(Number).sort((a, b) => a - b);
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const sx = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - v * (H - m.t - m.b);
  const { setTip, node } = useTip();
  return (
    <figure className="viz" ref={ref}>
      <Legend items={[{ label: "Singapore", color: SG, kind: "line" }, { label: "Johor Bahru", color: JB, kind: "line" }]} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 6} y={sy(t) + 4} textAnchor="end" className="tick">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {xs.map((x) => (
          <text key={x} x={sx(x)} y={H - 10} textAnchor="middle" className="tick">
            {x} min
          </text>
        ))}
        <line x1={m.l} x2={W - m.r} y1={sy(0)} y2={sy(0)} className="axis" />
        {(["sg", "jb"] as const).map((c) => {
          const pts = xs.map((x) => [sx(x), sy(data[c][String(x)])] as const);
          const last = pts[pts.length - 1];
          return (
            <g key={c}>
              <path d={pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("")} fill="none" stroke={cssRGB(CITY_COLOR[c])} strokeWidth={2} strokeLinejoin="round" />
              {xs.map((x, i) => (
                <g key={x} onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 14, body: `${CITY_NAME[c]}, ${x} min: ${pct(data[c][String(x)], 1)}` })} onMouseLeave={() => setTip(null)}>
                  <circle cx={pts[i][0]} cy={pts[i][1]} r={12} fill="transparent" />
                  <circle cx={pts[i][0]} cy={pts[i][1]} r={x === 15 ? 5.5 : 4} fill={cssRGB(CITY_COLOR[c])} stroke="var(--ink-2)" strokeWidth={2} />
                </g>
              ))}
              <text x={last[0] + 10} y={last[1] + 4} className="lbl">
                {CITY_NAME[c] === "Singapore" ? "SG" : "JB"} {pct(data[c][String(x1)])}
              </text>
            </g>
          );
        })}
      </svg>
      {node}
      <DataTable caption={caption} head={["Walking time", "Singapore", "Johor Bahru"]} rows={xs.map((x) => [`${x} min`, pct(data.sg[String(x)], 1), pct(data.jb[String(x)], 1)])} />
    </figure>
  );
}

// --------------------------------------------------------------------------- neighbourhood strip

export interface UnitPoint {
  id: string;
  name: string;
  city: "sg" | "jb";
  value: number;
  population: number;
}

/** One row per city; one dot per neighbourhood (≥ min residents), sized by residents. */
export function NeighbourhoodStrip({ units, caption, labelIds }: { units: UnitPoint[]; caption: string; labelIds: Set<string> }) {
  const [ref, W] = useWidth();
  const rowH = 74;
  const x0 = 96;
  const x1 = W - 16;
  const sx = (v: number) => x0 + v * (x1 - x0);
  const maxPop = Math.max(...units.map((u) => u.population), 1);
  const r = (p: number) => 3 + 7 * Math.sqrt(p / maxPop);
  const { setTip, node } = useTip();
  const H = 2 * rowH + 26;
  return (
    <figure className="viz" ref={ref}>
      <Legend items={[{ label: "Singapore planning area", color: SG }, { label: "Johor Bahru state constituency", color: JB }]} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={0} y2={2 * rowH} className="grid" />
            <text x={sx(t)} y={2 * rowH + 16} textAnchor="middle" className="tick">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {(["sg", "jb"] as const).map((c, ci) => {
          const y = ci * rowH + rowH / 2;
          const list = units.filter((u) => u.city === c).sort((a, b) => b.population - a.population);
          return (
            <g key={c}>
              <text x={0} y={y + 4} className="lbl">
                {CITY_NAME[c]}
              </text>
              {list.map((u) => (
                <g key={u.id} onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 14, body: `${u.name}: ${pct(u.value)} complete · ${Math.round(u.population).toLocaleString()} residents` })} onMouseLeave={() => setTip(null)}>
                  <circle cx={sx(u.value)} cy={y} r={Math.max(9, r(u.population) + 3)} fill="transparent" />
                  <circle cx={sx(u.value)} cy={y} r={r(u.population)} fill={cssRGB(CITY_COLOR[c], 0.85)} stroke="var(--ink-2)" strokeWidth={1.5} />
                </g>
              ))}
              {list
                .filter((u) => labelIds.has(u.id))
                .map((u, i) => (
                  <text key={u.id} x={sx(u.value)} y={y + (i % 2 ? 26 : -18)} textAnchor="middle" className="tick strong">
                    {u.name}
                  </text>
                ))}
            </g>
          );
        })}
      </svg>
      {node}
      <DataTable
        caption={caption}
        head={["Neighbourhood", "City", "Complete", "Residents"]}
        rows={[...units].sort((a, b) => a.value - b.value).map((u) => [u.name, CITY_NAME[u.city], pct(u.value, 1), Math.round(u.population).toLocaleString()])}
      />
    </figure>
  );
}

// --------------------------------------------------------------------------- source comparison

/** Destinations per 10,000 residents: filled = OpenStreetMap, ring = Overture Places (composite encoding). */
export function SourceDots({ rows, caption }: { rows: { city: "sg" | "jb"; label: string; osm: number; overture: number }[]; caption: string }) {
  const [ref, W] = useWidth();
  const rowH = 26;
  const x0 = 170;
  const x1 = W - 16;
  const max = Math.max(...rows.flatMap((r) => [r.osm, r.overture])) * 1.05;
  const sx = (v: number) => x0 + (v / max) * (x1 - x0);
  const H = rows.length * rowH + 26;
  const ticks = [0, 10, 20, 30, 40, 50].filter((t) => t <= max);
  const { setTip, node } = useTip();
  return (
    <figure className="viz" ref={ref}>
      <div className="viz-legend">
        <span>
          <i className="dot" style={{ background: "var(--paper-1)" }} /> OpenStreetMap
        </span>
        <span>
          <i className="dot ring" /> Overture Places
        </span>
        <span>
          <i className="dot" style={{ background: cssRGB(SG) }} /> Singapore
        </span>
        <span>
          <i className="dot" style={{ background: cssRGB(JB) }} /> Johor Bahru
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={0} y2={rows.length * rowH} className="grid" />
            <text x={sx(t)} y={rows.length * rowH + 16} textAnchor="middle" className="tick">
              {t}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = i * rowH + rowH / 2;
          const col = cssRGB(CITY_COLOR[r.city]);
          return (
            <g key={`${r.city}-${r.label}`} onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 14, body: `${CITY_NAME[r.city]} · ${r.label}: OSM ${r.osm.toFixed(1)}, Overture ${r.overture.toFixed(1)} per 10,000 residents` })} onMouseLeave={() => setTip(null)}>
              <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text x={0} y={y + 4} className="lbl">
                {r.label} <tspan className="muted-svg">· {r.city === "sg" ? "SG" : "JB"}</tspan>
              </text>
              <line x1={sx(Math.min(r.osm, r.overture))} x2={sx(Math.max(r.osm, r.overture))} y1={y} y2={y} className="connector" />
              <circle cx={sx(r.overture)} cy={y} r={5} fill="var(--ink-2)" stroke={col} strokeWidth={2} />
              <circle cx={sx(r.osm)} cy={y} r={5} fill={col} stroke="var(--ink-2)" strokeWidth={1.5} />
            </g>
          );
        })}
      </svg>
      {node}
      <DataTable caption={caption} head={["Category", "City", "OSM / 10k", "Overture / 10k"]} rows={rows.map((r) => [r.label, CITY_NAME[r.city], r.osm.toFixed(1), r.overture.toFixed(1)])} />
    </figure>
  );
}

// --------------------------------------------------------------------------- sensitivity strip

/** Every assumption combination as a dot; the published baseline as a tick. */
export function GridStrip({ runs, baseline, caption }: { runs: { sg: number; jb: number; label: string }[]; baseline: Record<"sg" | "jb", number>; caption: string }) {
  const [ref, W] = useWidth();
  const rowH = 64;
  const x0 = 96;
  const x1 = W - 16;
  const sx = (v: number) => x0 + v * (x1 - x0);
  const H = 2 * rowH + 26;
  const { setTip, node } = useTip();
  const jit = (i: number) => (((i * 7919) % 97) / 97 - 0.5) * 26;
  const q = (c: "sg" | "jb", p: number) => {
    const v = runs.map((r) => r[c]).sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  };
  return (
    <figure className="viz" ref={ref}>
      <Legend items={[{ label: "Singapore", color: SG }, { label: "Johor Bahru", color: JB }]} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={0} y2={2 * rowH} className="grid" />
            <text x={sx(t)} y={2 * rowH + 16} textAnchor="middle" className="tick">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {(["sg", "jb"] as const).map((c, ci) => {
          const y = ci * rowH + rowH / 2;
          return (
            <g key={c}>
              <text x={0} y={y + 4} className="lbl">
                {CITY_NAME[c]}
              </text>
              {runs.map((r, i) => (
                <circle
                  key={i}
                  cx={sx(r[c])}
                  cy={y + jit(i)}
                  r={3.2}
                  fill={cssRGB(CITY_COLOR[c], 0.75)}
                  onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 14, body: `${CITY_NAME[c]} ${pct(r[c], 1)} — ${r.label}` })}
                  onMouseLeave={() => setTip(null)}
                />
              ))}
              <line x1={sx(baseline[c])} x2={sx(baseline[c])} y1={y - 20} y2={y + 20} stroke="var(--paper-0)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      {node}
      <p className="viz-note">White tick: published baseline (1.2 m/s, 15 min, core definitions, permissive network, HRSL population).</p>
      <DataTable
        caption={caption}
        head={["City", "Lowest run", "Median run", "Highest run", "Baseline"]}
        rows={(["sg", "jb"] as const).map((c) => [CITY_NAME[c], pct(q(c, 0), 1), pct(q(c, 0.5), 1), pct(q(c, 1), 1), pct(baseline[c], 1)])}
      />
    </figure>
  );
}
