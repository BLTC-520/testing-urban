import { useMemo } from "react";
import { CATEGORY_COLOR, cssRGB, GAIN, NEUTRAL } from "../lib/colors";
import type { Footpath, XY } from "../lib/footpath";

/**
 * A still map of the one-footpath scenario, drawn as SVG from the published
 * geometry (metres around the new link), so it needs no WebGL and survives
 * prerendering. North is up; y is flipped once for the whole drawing.
 */
const d = (pts: XY[], close = false) => (pts.length ? `M${pts.map((p) => `${p[0]},${-p[1]}`).join("L")}${close ? "Z" : ""}` : "");

export function FootpathFigure({ fp }: { fp: Footpath }) {
  const f = fp.figure;
  const [x0, y0, x1, y1] = f.box;
  const w = x1 - x0;
  const h = y1 - y0;
  const paths = useMemo(
    () => ({
      buildings: f.buildings.map((r) => d(r, true)).join(""),
      water: f.water.map((r) => d(r, true)).join(""),
      waterways: f.waterways.map((r) => d(r)).join(""),
      major: f.streets.major.map((r) => d(r)).join(""),
      minor: f.streets.minor.map((r) => d(r)).join(""),
      path: f.streets.path.map((r) => d(r)).join(""),
      gain: f.hexes.filter((x) => x.after > x.before).map((x) => d(x.ring, true)).join(""),
    }),
    [f],
  );
  const routes = fp.routes;
  const dests = new Map<string, { xy: XY; essential: string; name: string }>();
  for (const r of routes) {
    const last = r.after.xy[r.after.xy.length - 1];
    dests.set(r.after.destination.name || `${last}`, { xy: last, essential: r.essential, name: r.after.destination.name });
  }
  const [la, lb] = f.link;
  const scale = Math.max(50, Math.round(w / 6 / 50) * 50);
  const label = (xy: XY, text: string, anchor: "start" | "end" | "middle" = "start", dy = 0) => (
    <text x={xy[0]} y={-xy[1] + dy} textAnchor={anchor} className="fp-label">
      {text}
    </text>
  );
  const c = fp.chosen;
  const west = la[0] <= lb[0];
  const aside = west ? la : lb;
  const bside = west ? lb : la;
  const aname = west ? c.a.street : c.b.street;
  const bname = west ? c.b.street : c.a.street;
  return (
    <svg
      className="fp-map"
      viewBox={`${x0} ${-y1} ${w} ${h}`}
      role="img"
      aria-label={`Map of ${c.place ?? c.unit_name}: a ${Math.round(c.link_m)} m footpath between ${c.a.street} and ${c.b.street}, with walking routes from sample homes before and after`}
    >
      <rect x={x0} y={-y1} width={w} height={h} className="fp-bg" />
      <path d={paths.water} className="fp-water" />
      <path d={paths.gain} className="fp-gain" style={{ fill: cssRGB(GAIN, 0.28) }} />
      <path d={paths.buildings} className="fp-building" />
      <path d={paths.waterways} className="fp-waterway" />
      <path d={paths.path} className="fp-street path" />
      <path d={paths.minor} className="fp-street minor" />
      <path d={paths.major} className="fp-street major" />
      {routes.map((r, i) => (
        <path key={`b${i}`} d={d(r.before.xy)} className="fp-route before" style={{ stroke: cssRGB(NEUTRAL) }} />
      ))}
      {routes.map((r, i) => (
        <path key={`a${i}`} d={d(r.after.xy)} className="fp-route after" style={{ stroke: cssRGB(GAIN) }} />
      ))}
      <path d={d(f.link)} className="fp-link-halo" />
      <path d={d(f.link)} className="fp-link" style={{ stroke: cssRGB(GAIN) }} />
      {[...dests.values()].map((p) => (
        <g key={p.name} transform={`translate(${p.xy[0]},${-p.xy[1]})`}>
          <circle r={9} className="fp-dest" style={{ fill: cssRGB(CATEGORY_COLOR[p.essential] ?? NEUTRAL) }} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {routes.map((r, i) => {
        const p = r.before.xy[0];
        return <circle key={`h${i}`} cx={p[0]} cy={-p[1]} r={7} className="fp-home" vectorEffect="non-scaling-stroke" />;
      })}
      {label(aside, aname, "end", -14)}
      {label(bside, bname, "start", 22)}
      {[...dests.values()].map((p) => (
        <g key={`l${p.name}`}>{label(p.xy, p.name, p.xy[0] > x0 + w * 0.6 ? "end" : "start", -16)}</g>
      ))}
      <g transform={`translate(${x0 + w * 0.04},${-y0 - h * 0.06})`} className="fp-scale">
        <path d={`M0,0h${scale}`} vectorEffect="non-scaling-stroke" />
        <path d={`M0,-6v6M${scale},-6v6`} vectorEffect="non-scaling-stroke" />
        <text x={scale / 2} y={-12} textAnchor="middle">
          {scale} m
        </text>
      </g>
      <g transform={`translate(${x1 - w * 0.04},${-y1 + h * 0.08})`} className="fp-north">
        <path d="M0,-22L8,4L0,-2L-8,4Z" />
        <text y={24} textAnchor="middle">
          N
        </text>
      </g>
    </svg>
  );
}

export function FootpathLegend() {
  return (
    <div className="viz-legend fp-legend" role="list">
      <span role="listitem">
        <i className="sw line dashed" style={{ borderColor: cssRGB(NEUTRAL) }} /> Walk today
      </span>
      <span role="listitem">
        <i className="sw line" style={{ borderColor: cssRGB(GAIN) }} /> Walk with the path
      </span>
      <span role="listitem">
        <i className="sw line thick" style={{ borderColor: cssRGB(GAIN) }} /> New path
      </span>
      <span role="listitem">
        <i className="sw area" style={{ background: cssRGB(GAIN, 0.35) }} /> Homes that gain an essential
      </span>
      <span role="listitem">
        <i className="sw dot home" /> Sample home
      </span>
      <span role="listitem">
        <i className="sw dot" style={{ background: cssRGB(CATEGORY_COLOR.healthcare) }} /> Clinic reached
      </span>
    </div>
  );
}
