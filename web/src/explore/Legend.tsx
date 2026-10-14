import { RAMP, cssRGB, rampAt } from "../lib/colors";
import type { MetricId } from "../lib/store";
import type { Meta } from "../lib/types";

export function Legend({ meta, kind, metric, threshold, iso, speed }: { meta: Meta; kind: "count" | "minutes"; metric: MetricId; threshold: number; iso: boolean; speed: number }) {
  const label = meta.categories.find((c) => c.id === metric)?.label ?? "";
  return (
    <div className="legend" aria-label="Map legend">
      {kind === "count" ? (
        <>
          <div className="legend-title">
            Essentials within {threshold} min on foot <span className="muted">(of 6)</span>
          </div>
          <div className="legend-steps">
            {RAMP.map((c, i) => (
              <div key={i} className="step">
                <span style={{ background: cssRGB(c) }} />
                <em>{i}</em>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="legend-title">Walk to nearest {label.toLowerCase()}</div>
          <div className="legend-grad" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((x) => cssRGB(rampAt(1 - x))).join(",")})` }} />
          <div className="legend-ticks">
            <em>0</em>
            <em>10</em>
            <em>20</em>
            <em>30+ min</em>
          </div>
        </>
      )}
      {iso ? (
        <div className="legend-iso">
          <div className="legend-title">Walk-shed from the selected spot · {speed} m/s</div>
          <div className="legend-bands">
            {[0, 1, 2, 3].map((b) => (
              <span key={b}>
                <i style={{ background: cssRGB(RAMP[6 - b]) }} />
                {b * 5}–{(b + 1) * 5}
              </span>
            ))}
            <span className="muted">min</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
