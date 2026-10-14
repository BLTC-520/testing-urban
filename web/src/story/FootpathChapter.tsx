import { useEffect, useRef, useState } from "react";
import { Badge } from "../components/Controls";
import { about, useFootpath } from "../lib/footpath";
import { int } from "../lib/format";
import { href } from "../lib/router";
import type { Meta } from "../lib/types";
import { FootpathFigure, FootpathLegend } from "./FootpathFigure";
import "./footpath.css";
import { Essay, Kicker } from "./parts";

/** Load the scenario once the reader is within a few screens of the chapter. */
function useNear(margin = "1600px 0px") {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => !("IntersectionObserver" in window));
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}

const mins = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${x.toFixed(0)} min`);

export function FootpathChapter({ meta, n }: { meta: Meta; n: string }) {
  const [ref, near] = useNear();
  const fp = useFootpath(near);
  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const c = fp?.chosen;
  const m15 = c?.metrics["15min"];
  const where = c ? (c.place && c.place !== c.unit_name ? `${c.place} (${c.unit_name})` : c.unit_name) : "";
  return (
    <Essay id="footpath">
      <div ref={ref}>
        <Kicker n={n}>One footpath</Kicker>
        {!fp || !c || !m15 ? (
          <>
            <h2>The smallest intervention</h2>
            <p className="muted small" data-loading>
              Loading the footpath scenario…
            </p>
          </>
        ) : (
          <>
            <h2>
              A {Math.round(c.link_m)}-metre path in {c.place ?? c.unit_name}
            </h2>
            <p className="lede">
              The other scenarios change transport or land use. The smallest change is to the street network itself. Johor Bahru's estates were built as separate networks of
              cul-de-sacs and back lanes, so many homes are a few dozen metres from the next street in a straight line and a long walk away on foot.
            </p>
            <p>
              We looked for those gaps everywhere in Johor Bahru: every dead end, paired with any street point within {fp.parameters.max_link_m} m in a straight line that is at
              least {fp.parameters.min_saving_m} m further away on foot ({int(fp.screening.dead_ends_paired)} pairs). {int(fp.screening.passed_desk_filters)} passed desk checks: no
              building within {fp.parameters.building_clearance_m} m of the line, no water, railway, major road or mapped wall or fence in the way, no school, hospital or other
              compound, and both ends on public streets. For each, the walk to every essential was recalculated for every home in Johor Bahru.
            </p>
            <p>
              The best is in {where}, where {c.a.street} and {c.b.street} are {Math.round(c.link_m)} m apart in a straight line and{" "}
              {c.walk_today_m ? `${int(c.walk_today_m)} m` : "much further"} apart on foot today.
            </p>

            <div className="fp-figures">
              <div className="fp-figure">
                <div className="fp-value">{about(m15.residents_gaining)}</div>
                <div className="fp-text">residents would gain at least one essential within a 15-minute walk</div>
              </div>
              <div className="fp-figure">
                <div className="fp-value">{about(m15.newly_complete)}</div>
                <div className="fp-text">would then have all six essentials within 15 minutes</div>
              </div>
              <div className="fp-figure">
                <div className="fp-value">{about(c.changes.residents_walk_5min_shorter)}</div>
                <div className="fp-text">residents would walk at least 5 minutes less to one or more essentials</div>
              </div>
            </div>

            <figure className="fp-fig">
              <FootpathLegend />
              <FootpathFigure fp={fp} />
              <figcaption>
                Streets, buildings and drains from OpenStreetMap ({meta.osm_snapshot}). Dashed: today's shortest walk from three sample homes to the nearest essential they gain;
                solid: the same trip with the path. Shaded hexagons: homes that would gain at least one essential within 15 minutes. <Badge kind="scenario" /> <Badge kind="calculated">walking times</Badge>{" "}
                <Badge kind="modelled">residents</Badge>
              </figcaption>
            </figure>

            <h3>What changes, essential by essential</h3>
            <div className="table-wrap">
              <table className="fp-table">
                <thead>
                  <tr>
                    <th scope="col">Essential</th>
                    <th scope="col">Residents newly within 15 min</th>
                    <th scope="col">Their median walk: today → with the path</th>
                  </tr>
                </thead>
                <tbody>
                  {c.changes.by_essential
                    .filter((r) => r.residents_newly_within_15min > 0)
                    .sort((a, b) => b.residents_newly_within_15min - a.residents_newly_within_15min)
                    .map((r) => (
                      <tr key={r.essential}>
                        <td>{label(r.essential)}</td>
                        <td className="num">{about(r.residents_newly_within_15min)}</td>
                        <td className="num">
                          {mins(r.median_minutes_before)} → {mins(r.median_minutes_after)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <h3>Three sample homes</h3>
            <ul className="fp-routes">
              {fp.routes.map((r, i) => (
                <li key={i}>
                  <b>Home {i + 1}</b> to {r.after.destination.name || label(r.essential).toLowerCase()} ({label(r.essential).toLowerCase()}):{" "}
                  <span className="num">{r.before.minutes.toFixed(0)} min</span> today, <span className="num">{r.after.minutes.toFixed(0)} min</span> with the path.
                </li>
              ))}
            </ul>

            <p>
              The size of the gain depends on the assumptions, but it does not vanish: at a 10-minute limit {about(c.metrics["10min"].residents_gaining)} residents gain an essential, at 20 minutes{" "}
              {about(c.metrics["20min"].residents_gaining)}, and walking at {meta.accessibility.walk_speed_mps.slow} m/s {about(c.metrics["15min_slow"].residents_gaining)}.{" "}
              {fp.alternatives.length} other places in Johor Bahru would each give {about(fp.alternatives[fp.alternatives.length - 1].metrics["15min"].residents_gaining)} to{" "}
              {about(fp.alternatives[0].metrics["15min"].residents_gaining)} residents a new essential; they are listed on the{" "}
              <a href={href("/methods", undefined, "footpath")}>Methods</a> page.
            </p>

            <div className="callout fp-checks">
              <h4>A desk study: check on site before building</h4>
              <ul>
                {fp.site_checks.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="small muted">Assumed: {fp.assumptions.join(" ")}</p>
            </div>
          </>
        )}
      </div>
    </Essay>
  );
}
