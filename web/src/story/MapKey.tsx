import { cssRGB, GAIN, RAMP } from "../lib/colors";
import type { Mode } from "../lib/crossborder";
import { regionalColor } from "./storyLayers";

const MODE_LABEL: Record<Mode, string> = {
  baseline: "Today: Causeway bus or KTM shuttle",
  rts: "RTS Link, reached by walking and bus",
  rts_av: "RTS Link + shared autonomous feeder",
};

/** The story map's legend; it changes with the scene. */
export function MapKey({
  kind,
  k,
  borderMode,
  hubs,
  after,
  extruded = false,
}: {
  kind: "essentials" | "walk" | "border" | "parking";
  k: number;
  borderMode: Mode | null;
  hubs: number;
  after: boolean;
  extruded?: boolean;
}) {
  return (
    <div className="map-key" aria-hidden="true">
      {kind === "essentials" ? (
        <>
          <div className="mk-title">Essentials within a 15-minute walk</div>
          <div className="mk-ramp">
            {RAMP.slice(0, k + 1).map((c, i) => (
              <span key={i} style={{ background: cssRGB(c) }} />
            ))}
          </div>
          <div className="mk-ticks">
            <span>0</span>
            <span>{k} of {k}</span>
          </div>
          {extruded ? <div className="mk-note">Column height: residents in each hexagon</div> : null}
        </>
      ) : null}
      {kind === "walk" ? (
        <>
          <div className="mk-title">Walking on the street network</div>
          {[0, 1, 2].map((b) => (
            <div key={b} className="mk-row">
              <i className="mk-line" style={{ background: cssRGB(RAMP[6 - b]) }} /> {b * 5}–{(b + 1) * 5} min
            </div>
          ))}
          <div className="mk-row">
            <i className="mk-circle" /> 15 min as the crow flies (1.08 km)
          </div>
        </>
      ) : null}
      {kind === "border" ? (
        <>
          <div className="mk-title">Home → first Singapore MRT platform</div>
          <div className="mk-gradient" style={{ background: `linear-gradient(90deg, ${[40, 70, 100, 130, 160].map((m) => cssRGB(regionalColor(m))).join(",")})` }} />
          <div className="mk-ticks">
            <span>≤ 40 min</span>
            <span>100</span>
            <span>≥ 160 min</span>
          </div>
          {borderMode ? <div className="mk-mode">{MODE_LABEL[borderMode]}</div> : null}
        </>
      ) : null}
      {kind === "parking" ? (
        <>
          <div className="mk-title">Parking to Proximity · {hubs} hubs</div>
          <div className="mk-row">
            <i className="mk-swatch" style={{ background: cssRGB(GAIN) }} /> {after ? "Newly within reach of all six" : "(scenario off)"}
          </div>
          <div className="mk-row">
            <i className="mk-site" /> Car park converted to a hub
          </div>
          <div className="mk-row muted">Other cells: today's completeness, dimmed</div>
        </>
      ) : null}
    </div>
  );
}
