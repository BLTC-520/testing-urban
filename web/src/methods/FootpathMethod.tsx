import { Badge } from "../components/Controls";
import { Tex } from "../components/Tex";
import { about, useFootpath } from "../lib/footpath";
import { int } from "../lib/format";

const REASONS: Record<string, string> = {
  x_street: "crosses another walkable way (so a shorter link exists)",
  x_not_public: "an end is on a service road, track or corridor",
  x_building: "passes within the clearance of a building",
  x_barrier: "crosses a river, canal, stream, railway, major road, wall or fence",
  x_site: "crosses a school, hospital, cemetery, military or prison site",
  x_elevated: "an end is on a bridge or in a tunnel",
  x_water: "crosses open water",
};

/** Methods: scenario 3, one footpath (numbers from footpath.json). */
export function FootpathMethod() {
  const fp = useFootpath();
  if (!fp)
    return (
      <p className="muted small" data-loading>
        Loading the footpath scenario…
      </p>
    );
  const c = fp.chosen;
  const p = fp.parameters;
  const v = fp.validation;
  return (
    <>
      <h3 id="footpath">3 · One footpath (local)</h3>
      <p>{fp.question}</p>
      <ol className="m-steps">
        <li>
          <b>Candidates.</b> Every dead end of the Johor Bahru walk network is paired with each network node within {p.max_link_m} m in a straight line that is at least{" "}
          {p.min_saving_m} m further away on foot (a bounded search from the dead end): {int(fp.screening.dead_ends_paired)} pairs.
        </li>
        <li>
          <b>Desk filters.</b> A pair is dropped when the straight link {Object.keys(REASONS).map((k) => REASONS[k]).join("; ")}. Links over a mapped drain or ditch are kept and
          flagged as needing a footbridge. {int(fp.screening.passed_desk_filters)} pairs pass; {int(fp.screening.with_any_gain)} of them would bring someone a new essential.
        </li>
        <li>
          <b>Exact evaluation.</b> A shortest path uses a new edge at most once, so with the link <Tex>{String.raw`(a, b)`}</Tex> of length <Tex>\ell</Tex> the distance from
          cell <Tex>i</Tex> to the nearest destination of essential <Tex>k</Tex> becomes
        </li>
      </ol>
      <figure className="formula">
        <Tex block>{String.raw`d'_{ik} = \min\bigl(d_{ik},\; d_{ia} + \ell + D_k(b),\; d_{ib} + \ell + D_k(a)\bigr)`}</Tex>
        <figcaption>
          <Tex>{String.raw`D_k`}</Tex>: baseline distance from every node to the nearest destination of <Tex>k</Tex>; <Tex>{String.raw`d_{ia}, d_{ib}`}</Tex>: baseline walk from
          the cell to each end (bounded searches). A unit test checks this against a full recomputation on random graphs.
        </figcaption>
      </figure>
      <p>
        Homes and destinations keep their current access points and nothing else changes. Every candidate is scored for every Johor Bahru cell; the one that gives the most
        residents at least one more essential within {p.threshold_min} minutes is chosen (ties: residents newly reaching all six). Alternatives listed below are at least 400 m
        apart.
      </p>
      <p>
        <Badge kind="calculated" /> Recomputing the baseline this way reproduces the published distances for all {int(v.baseline_cells)} Johor Bahru cells (largest difference{" "}
        {v.baseline_max_abs_diff_m < 0.01 ? "under 1 cm" : `${v.baseline_max_abs_diff_m.toFixed(2)} m`}), and each sample route, traced node by node, has the same length as the
        engine's distance{v.routes_match_engine ? "" : " (check failed)"}. <Badge kind="scenario" /> The link itself; <Badge kind="assumed" /> {fp.assumptions.join(" ")}
      </p>
      <div className="table-wrap">
        <table className="m-table compact">
          <thead>
            <tr>
              <th>Place</th>
              <th>Between</th>
              <th className="num">Link</th>
              <th className="num">Walk today</th>
              <th className="num">Residents gaining an essential</th>
              <th className="num">Newly all six</th>
            </tr>
          </thead>
          <tbody>
            {[c, ...fp.alternatives].map((s, i) => (
              <tr key={`${s.a.lon},${s.a.lat}`}>
                <td>
                  {i === 0 ? <b>{s.place ?? s.unit_name}</b> : (s.place ?? s.unit_name)} <span className="muted small">({s.unit_name})</span>
                </td>
                <td className="small">
                  {s.a.street} – {s.b.street}
                  {s.footbridge ? " (footbridge)" : ""}
                </td>
                <td className="num">{Math.round(s.link_m)} m</td>
                <td className="num">{s.walk_today_m ? `${int(s.walk_today_m)} m` : "not connected"}</td>
                <td className="num">{about(s.metrics["15min"].residents_gaining)}</td>
                <td className="num">{about(s.metrics["15min"].newly_complete)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Street names are from OpenStreetMap; "residential" or "steps" means the way has no name. This is a desk study: ownership, unmapped walls and gates, drain widths, informal
        paths and residents' views can only be checked on site.
      </p>
    </>
  );
}
