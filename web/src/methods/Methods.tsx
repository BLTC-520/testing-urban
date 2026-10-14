import { useEffect, useState, type ReactNode } from "react";
import { Badge, type Evidence } from "../components/Controls";
import { Header } from "../components/Header";
import { Tex } from "../components/Tex";
import { FootpathMethod } from "./FootpathMethod";
import { loadMeta, loadSummary, peekMeta, peekSummary } from "../lib/data";
import { int, pct } from "../lib/format";
import type { Meta, Summary } from "../lib/types";
import "./methods.css";

const TOC = [
  ["question", "Question & scope"],
  ["data", "Data register"],
  ["network", "Street network"],
  ["destinations", "Destinations"],
  ["population", "Population"],
  ["metrics", "Metrics"],
  ["form", "Urban form"],
  ["scenarios", "Scenarios"],
  ["validation", "Validation"],
  ["sensitivity", "Sensitivity"],
  ["limitations", "Limitations"],
  ["reproduce", "Reproduce"],
  ["architecture", "Architecture"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="m-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Formula({ tex, note }: { tex: string; note?: ReactNode }) {
  return (
    <figure className="formula">
      <Tex block>{tex}</Tex>
      {note ? <figcaption>{note}</figcaption> : null}
    </figure>
  );
}

/** "subzone" → "subzones", "state constituency" → "state constituencies". */
const pluralUnit = (u: string) => (u.endsWith("y") ? `${u.slice(0, -1)}ies` : `${u}s`);

/** The two censuses count different populations. The all-persons bound is computed from summary.json. */
function WhoIsCounted({ summary, nonResidents, source }: { summary: Summary; nonResidents: number; source?: string }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  // Complete residents are at least share × on-network residents, whatever the non-residents' access.
  const completeResidents = sg.share_complete * sg.population_on_network;
  const allPersons = sg.population + nonResidents;
  const bound = completeResidents / allPersons;
  const gapNow = Math.round((sg.share_complete - jb.share_complete) * 100);
  const gapBound = Math.round((bound - jb.share_complete) * 100);
  return (
    <>
      <p>
        <strong>Who is counted.</strong> Singapore's figures cover residents, citizens and permanent residents: {(sg.population / 1e6).toFixed(2)} million in the Census of Population
        2020. About {(nonResidents / 1e6).toFixed(2)} million non-residents, many of them work-permit holders living in worker dormitories, often in industrial areas, are outside that count.
        Johor Bahru's census counts all persons, including non-citizens, so the comparison sets Singapore's residents against all of Johor Bahru's population.
      </p>
      <p>
        The effect can be bounded from the data. Even if none of Singapore's non-residents had all six essentials within reach, Singapore's share of all persons would still be at
        least <strong>{pct(bound, 1)}</strong> (at least {(completeResidents / 1e6).toFixed(2)} million complete residents out of {(allPersons / 1e6).toFixed(2)} million persons), against{" "}
        {pct(jb.share_complete, 1)} in Johor Bahru. The direction of the finding cannot flip. The gap is at least {gapBound} points, against {gapNow} for residents alone.
      </p>
      {source ? <p className="small muted">Non-residents: {source}.</p> : null}
    </>
  );
}

export function Methods() {
  const [meta, setMeta] = useState<Meta | null>(peekMeta);
  const [summary, setSummary] = useState<Summary | null>(peekSummary);
  const [active, setActive] = useState<string>("question");
  useEffect(() => {
    loadMeta().then(setMeta);
    loadSummary().then(setSummary);
  }, []);
  // a deep link to a section (/methods/#metrics) lands there once the data-driven content is in place
  const ready = meta !== null && summary !== null;
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (el) requestAnimationFrame(() => el.scrollIntoView());
  }, [ready]);
  useEffect(() => {
    const on = () => {
      let cur: string = TOC[0][0];
      for (const [id] of TOC) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.3) cur = id;
      }
      setActive(cur);
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const acc = meta?.accessibility;
  const cb = meta?.crossborder;
  const sgNonResidents = meta?.cities.sg.non_residents;
  return (
    <div className="methods">
      <Header path="/methods" />
      <div className="m-layout">
        <nav className="m-toc" aria-label="Contents">
          <div className="eyebrow">Methods</div>
          <ol>
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} onClick={(e) => (e.preventDefault(), history.replaceState(null, "", `#${id}`), document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }))} aria-current={active === id ? "true" : undefined}>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="m-body">
          <header className="m-head">
            <div className="eyebrow">Methodology · v{meta?.version ?? "1"}</div>
            <h1>How the numbers are made</h1>
            <p className="lede">
              Every result in this project is computed by an open, deterministic pipeline from public data. This page documents what was measured, what was calculated, what was
              modelled and what was assumed — and how far each can be trusted.
            </p>
            <div className="m-badges">
              {(["observed", "calculated", "modelled", "assumed", "scenario"] as Evidence[]).map((k) => (
                <Badge key={k} kind={k} />
              ))}
            </div>
          </header>

          <Section id="question" title="Question & scope">
            <p>
              <strong>Question.</strong> How does walkable access to everyday essentials differ between Singapore and Johor Bahru, why, and how could future mobility and urban
              interventions change it?
            </p>
            <p>
              <strong>Study area.</strong> Singapore: the 55 planning areas (URA Master Plan 2019), residents from the Census of Population 2020 by subzone. Johor Bahru: the ten state
              constituencies N.40–N.49 (Tiram, Puteri Wangsa, Johor Jaya, Permas, Larkin, Stulang, Perling, Kempas, Skudai, Kota Iskandar), covering Johor Bahru, Iskandar Puteri
              and Pasir Gudang, population from the Malaysian Population and Housing Census 2020. Analysis grid: H3 resolution 10 hexagons (≈0.015 km², ≈66 m edge).
            </p>
            <p>
              <strong>Not in scope.</strong> Travel by car, cycling, quality or price of services, opening hours, heat and shade, perceived safety, and trips across the border inside
              the 15-minute measure (the border is treated separately as a regional scenario).
            </p>
          </Section>

          <Section id="data" title="Data register">
            <p>Each source is classified and cited. Download checksums and retrieval times are written to data/provenance.json by the acquisition step.</p>
            <div className="table-wrap">
              <table className="m-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Class</th>
                    <th>Licence</th>
                    <th>Used for</th>
                  </tr>
                </thead>
                <tbody>
                  {meta?.sources.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.name}
                        </a>
                        <div className="muted small">{s.provider}</div>
                      </td>
                      <td>
                        <Badge kind={s.class as Evidence} />
                      </td>
                      <td className="small">{s.licence}</td>
                      <td className="small">{s.used_for.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="network" title="Street network">
            <p>
              The walking network is built from OpenStreetMap ways (snapshot {meta?.osm_snapshot}). Footways, paths, pedestrian streets, steps, corridors, cycleways (unless{" "}
              <code>foot=no</code>), service roads, residential streets and arterial roads are walkable; ways tagged <code>foot=no|private|use_sidepath</code>,{" "}
              <code>access=private|no</code> (unless foot is explicitly permitted), indoor rooms and areas are not. Components smaller than 200 nodes are dropped. Edge lengths are
              geodesic metres; walking time is length ÷ speed, so one search serves every speed.
            </p>
            <p>
              <strong>Strict variant.</strong> Trunk and primary carriageways are walkable only where a sidewalk is tagged. Singapore maps its pavements as separate footways, so it
              loses little; Johor Bahru loses walks along arterials that may have no pavement. The variant bounds how much Johor Bahru's measured access depends on such walks.
            </p>
            <p>
              <strong>Snapping.</strong> Origins and destinations join the network at the nearest point on the nearest edge (not the nearest node), reaching both end nodes with the
              along-edge offsets. The off-network leg is counted at 1.3 × its straight-line length; points further than 250 m from any walkable edge are treated as off-network.
              Parks are reached through points along their boundary, not their centroid.
            </p>
          </Section>

          <Section id="destinations" title="Destinations">
            <p>
              Six essentials form the basket. Each is defined by OpenStreetMap tags in three nested variants — strict ⊂ core ⊂ broad — and the core definition is the published
              baseline. Places with lifecycle prefixes (<code>disused:</code>, <code>abandoned:</code>, <code>construction:</code>…) are excluded.
            </p>
            <div className="table-wrap">
              <table className="m-table">
                <thead>
                  <tr>
                    <th>Essential</th>
                    <th>Strict</th>
                    <th>+ Core (baseline)</th>
                    <th>+ Broad</th>
                  </tr>
                </thead>
                <tbody>
                  {meta?.categories.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.label}</strong>
                        <div className="muted small">{c.basket ? "basket" : "supplementary"}</div>
                      </td>
                      <td className="tags">{c.includes?.strict.join(", ")}</td>
                      <td className="tags">
                        {c.includes?.core.join(", ") || "—"}
                        {c.min_area_m2 ? ` (parks ≥ ${c.min_area_m2.core / 10000} ha; strict ≥ ${c.min_area_m2.strict / 10000} ha)` : ""}
                      </td>
                      <td className="tags">{c.includes?.broad.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">
              The park threshold follows the WHO Regional Office for Europe (2016) indicator of green space of at least 0.5–1 ha within 300 m. Overture Places (release 2026-09-23,
              confidence ≥ 0.6) supplies an independent set of groceries, healthcare, education and dining places for the sensitivity run.
            </p>
          </Section>

          <Section id="population" title="Population">
            <p>
              Residents are distributed to H3 cells by dasymetric mapping: each census unit's count (Singapore subzones; Johor Bahru state constituencies) is spread over the cells
              in proportion to Meta/CIESIN HRSL settlement weights, so totals match the census exactly. Where HRSL sees no settlement inside a populated unit (e.g. Punggol's newest
              estates), Kontur population weights are used instead; Kontur is also the alternative population model in the sensitivity analysis. Residents aged 65+ come from the
              official age tables (SingStat by subzone; DOSM by constituency) and are spread with the HRSL elderly layer.
            </p>
            {summary ? (
              <div className="table-wrap">
                <table className="m-table compact">
                  <thead>
                    <tr>
                      <th>City</th>
                      <th>Model</th>
                      <th>Units</th>
                      <th>log-correlation</th>
                      <th>Units within ±25 %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.audit.population.map((r, i) => (
                      <tr key={i}>
                        <td>{r.city === "sg" ? "Singapore" : "Johor Bahru"}</td>
                        <td>{String(r.model)}</td>
                        <td>
                          {String(r.units)} {pluralUnit(String(r.unit))}
                        </td>
                        <td className="num">{Number(r.log_correlation).toFixed(2)}</td>
                        <td className="num">{pct(Number(r.share_units_within_25pct))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="small muted">
              Model counts summed by census unit before calibration, against the census. These figures describe where people are placed inside units; calibrated totals are exact.
            </p>
            {summary && sgNonResidents ? <WhoIsCounted summary={summary} nonResidents={sgNonResidents} source={meta?.cities.sg.non_residents_source} /> : null}
          </Section>

          <Section id="metrics" title="Metrics">
            <p>
              For each cell <Tex>i</Tex> and essential <Tex>k</Tex>, a multi-source Dijkstra search from every destination of <Tex>k</Tex> gives the network distance to the nearest
              one:
            </p>
            <Formula
              tex={String.raw`d_{ik} = \min\bigl(D_k(u) + o_u,\; D_k(v) + o_v\bigr) + 1.3\, s_i`}
              note={
                <>
                  <Tex>u, v</Tex>: end nodes of the edge the cell snaps to; <Tex>o_u, o_v</Tex>: along-edge offsets; <Tex>s_i</Tex>: snap distance; <Tex>D_k</Tex>: network
                  distance from the nearest destination of <Tex>k</Tex>
                </>
              }
            />
            <p>
              With walking speed <Tex>v</Tex> (baseline {acc?.walk_speed_mps.base} m/s) and time budget <Tex>\tau</Tex> (baseline {acc?.headline_threshold_min} min),{" "}
              <strong>completeness</strong> is the share of the {meta?.basket.length ?? 6} essentials within reach:
            </p>
            <Formula tex={String.raw`C_i(\tau) = \frac{1}{K} \sum_{k=1}^{K} \mathbf{1}\!\left[\, d_{ik} \le v\,\tau \,\right]`} />
            <p>
              Population-weighted indicators use the residents <Tex>w_i</Tex> of each cell. The headline is the <strong>share complete</strong>,{" "}
              <Tex>{String.raw`\sum_i w_i \mathbf{1}[C_i = 1] \,/\, \sum_i w_i`}</Tex>; a resident is in a <strong>low-access</strong> area when{" "}
              <Tex>{`C_i < ${acc?.low_access_completeness ?? 0.5}`}</Tex>. Distributions are summarised with weighted quantiles and a weighted Gini
              coefficient.
            </p>
            <p>
              Two robustness measures avoid the hard cut-off: <strong>cumulative opportunities</strong> (destinations within 5, 10, 15 and 20 minutes) and a{" "}
              <strong>gravity index</strong>
            </p>
            <Formula
              tex={String.raw`G_{ik} = \sum_{j \in k} e^{-\beta\, d_{ij}}, \qquad \beta = \frac{\ln 2}{h\, v}`}
              note={
                <>
                  <Tex>h</Tex>: half-life, {acc?.gravity_half_life_min ?? 10} min (the weight of a destination halves for every {acc?.gravity_half_life_min ?? 10} minutes of walking)
                </>
              }
            />
            <p>
              The explorer recomputes completeness in the browser from the published distances for any speed, threshold, definition or population group, using the same
              formulas (tested against the Python implementation).
            </p>
          </Section>

          <Section id="form" title="Urban form">
            <ul className="m-list">
              <li>
                <strong>Intersection density</strong>: nodes with three or more connections per km² of populated land.
              </li>
              <li>
                <strong>Dead-end share</strong>: nodes with a single connection.
              </li>
              <li>
                <strong>Pedestrian-way share</strong>: walkable length on footways, paths, pedestrian streets, steps and corridors.
              </li>
              <li>
                <strong>Arterial exposure</strong>: share of trunk/primary length with no sidewalk tagged.
              </li>
              <li>
                <strong>Pedestrian shed ratio</strong>: residents reached within 15 minutes on the network ÷ residents inside the 15-minute circle (1.08 km), for 1,500
                population-weighted sample homes per city.
              </li>
              <li>
                <strong>Circuity</strong>: network ÷ straight-line distance for local trips of 300–1,200 m.
              </li>
              <li>
                <strong>Parking land</strong>: mapped car-park polygons (surface and multi-storey), m² per resident.
              </li>
            </ul>
          </Section>

          <Section id="scenarios" title="Scenarios">
            <h3>1 · RTS Link: door to platform (regional)</h3>
            <p>Minutes from a Johor Bahru home to the first Singapore MRT platform, decomposed so that each term is either calculated or an explicit assumption:</p>
            <Formula
              tex={String.raw`T = T_{\text{access}}(\text{home} \to \text{hub}) + 2\,T_{\text{clearance}} + T_{\text{crossing}} + T_{\text{connection}}`}
            />
            <p>
              <Badge kind="calculated" /> <Tex>{String.raw`T_{\text{access}}`}</Tex> on real networks: walking, or walking plus myBAS buses with frequency-based waits (half the scheduled headway in the{" "}
              {meta?.crossborder ? "07:00–09:00" : ""} weekday window from the official GTFS, capped at 15 min, plus a 2-minute boarding margin), or a shared autonomous feeder on
              the road network. <Badge kind="assumed" /> Everything after the hub.
            </p>
            {cb ? (
              <div className="table-wrap">
                <table className="m-table compact">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Value</th>
                      <th>Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(cb.border_regimes).map(([k, r]) => (
                      <tr key={k}>
                        <td>Border regime “{k}”</td>
                        <td className="num">
                          {r.clearance_min_per_country} min per country · Causeway {r.causeway_ride_min} min
                        </td>
                        <td className="small">Assumption bracketing automated off-peak clearance to peak congestion</td>
                      </tr>
                    ))}
                    <tr>
                      <td>Causeway bus (today)</td>
                      <td className="num">
                        every {cb.baseline_bus.headway_min} min · +{cb.baseline_bus.checkpoint_to_mrt_min} min to MRT
                      </td>
                      <td className="small">Assumption</td>
                    </tr>
                    <tr>
                      <td>KTM Shuttle Tebrau (today)</td>
                      <td className="num">
                        {cb.baseline_rail.ride_min} min ride · {cb.baseline_rail.planned_wait_min} min planned wait · +{cb.baseline_rail.woodlands_ciq_to_mrt_min} min to MRT
                      </td>
                      <td className="small">Ride: KTMB GTFS; wait and transfer: assumptions</td>
                    </tr>
                    <tr>
                      <td>RTS Link</td>
                      <td className="num">
                        {cb.rts.ride_min} min ride · every {cb.rts.peak_headway_min} min · +{cb.rts.transfer_to_mrt_min} min to TEL
                      </td>
                      <td className="small">Ride, headway: official/reported design values; transfer: assumption</td>
                    </tr>
                    <tr>
                      <td>Autonomous feeder</td>
                      <td className="num">
                        wait {cb.av_feeder.wait_min.low}/{cb.av_feeder.wait_min.central}/{cb.av_feeder.wait_min.high} min · peak speed ×{cb.av_feeder.peak_speed_factor} · pooling ×
                        {cb.av_feeder.pooling_detour} · pickup ≤ {cb.av_feeder.walk_to_pickup_max_min} min walk
                      </td>
                      <td className="small">Assumptions</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="small muted">
              Not modelled: fares, capacity limits and queues at the RTS station, the possible retention of the KTM shuttle, and car or motorcycle crossings. Peak-day car queues of
              several hours are beyond the “peak” regime.
            </p>
            <h3>2 · Parking to Proximity (local)</h3>
            <p>
              Candidate sites are mapped car parks of at least {int(meta?.parking_to_proximity.min_site_area_m2)} m² (surface, multi-storey, rooftop or untagged; underground excluded).
              Converting a site adds a hub providing {meta?.parking_to_proximity.hub_program.join(", ")} at its access points; sites of 1 ha or more also provide green space. Sites
              are chosen greedily (maximal coverage): at each step, the site whose conversion makes the most residents newly complete. Results are reported for{" "}
              {meta?.parking_to_proximity.sites_per_city.join(", ")} sites per city. This is an exploration of where land could matter, not a forecast that autonomous vehicles will
              free it.
            </p>
            <FootpathMethod />
          </Section>

          <Section id="validation" title="Validation">
            <p>Every input with an independent reference is checked against it. Results:</p>
            {summary ? (
              <>
                <div className="table-wrap">
                  <table className="m-table compact">
                    <thead>
                      <tr>
                        <th>Check</th>
                        <th>Reference</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.audit.bus_stops.map((r, i) => (
                        <tr key={`b${i}`}>
                          <td>Bus stops, {r.city === "sg" ? "Singapore" : "Johor Bahru"}</td>
                          <td className="small">
                            {String(r.official_source)} ({int(Number(r.official_stops))})
                          </td>
                          <td className="num">
                            {pct(Number(r.recall_30m), 1)} matched within 30 m · {pct(Number(r.recall_60m), 1)} within 60 m
                          </td>
                        </tr>
                      ))}
                      {summary.audit.rail_stations.map((r, i) => (
                        <tr key={`r${i}`}>
                          <td>Rail stations, Singapore</td>
                          <td className="small">
                            {String(r.official_source)} ({int(Number(r.official_stations))})
                          </td>
                          <td className="num">
                            {pct(Number(r.recall_200m), 1)} within 200 m · {pct(Number(r.recall_400m), 1)} within 400 m
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>OpenStreetMap vs Overture Places</h3>
                <div className="table-wrap">
                  <table className="m-table compact">
                    <thead>
                      <tr>
                        <th>City</th>
                        <th>Category</th>
                        <th>OSM</th>
                        <th>Overture</th>
                        <th>OSM found in Overture (100 m)</th>
                        <th>Overture found in OSM (100 m)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.audit.poi_cross_source.map((r, i) => (
                        <tr key={i}>
                          <td>{r.city === "sg" ? "Singapore" : "Johor Bahru"}</td>
                          <td>{String(r.category).replace("_", " ")}</td>
                          <td className="num">{int(Number(r.osm_count))}</td>
                          <td className="num">{int(Number(r.overture_count))}</td>
                          <td className="num">{pct(Number(r.osm_found_in_overture_100m))}</td>
                          <td className="num">{pct(Number(r.overture_found_in_osm_100m))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </Section>

          <Section id="sensitivity" title="Sensitivity">
            <p>
              The analysis is repeated for every combination of walking speed (0.9, 1.2, 1.4 m/s), time budget (10, 15, 20 min), taxonomy variant (strict, core, broad), network
              variant (permissive, strict; the strict network with the core taxonomy only) and population model (HRSL, Kontur): {summary?.sensitivity.runs ?? 72} runs. A finding is{" "}
              <strong>robust</strong> if it holds in ≥ 90 % of runs, <strong>conditional</strong> in 50–90 %, <strong>fragile</strong> otherwise.
            </p>
            {summary ? (
              <div className="table-wrap">
                <table className="m-table compact">
                  <thead>
                    <tr>
                      <th>Finding</th>
                      <th>Holds in</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.sensitivity.findings.map((f) => (
                      <tr key={f.finding}>
                        <td>{f.statement}</td>
                        <td className="num">{pct(f.share_of_runs)}</td>
                        <td>{f.label.toLowerCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>

          <Section id="limitations" title="Limitations">
            <ul className="m-list">
              <li>
                <strong>Mapping completeness differs.</strong> OpenStreetMap coverage of shops, clinics and footways is not uniform; the Overture run and the stop/station audits bound
                the effect but cannot remove it.
              </li>
              <li>
                <strong>Presence is not service.</strong> A clinic is counted whether it is a polyclinic or a private GP; capacity, price, opening hours and quality are not measured.
              </li>
              <li>
                <strong>Walkability is more than connectivity.</strong> Heat, shade, rain, crossing waits, gradients, pavement condition and perceived safety are not in the network
                weights.
              </li>
              <li>
                <strong>Population inside census units is modelled.</strong> HRSL can miss new estates and misplace residents in mixed areas; calibrated totals are exact, the pattern
                inside each unit is an estimate.
              </li>
              <li>
                <strong>Different census definitions.</strong> Singapore counts residents (citizens and permanent residents, 2020); Malaysia counts all persons (2020). Neither is
                current to 2026.
              </li>
              <li>
                <strong>Scenarios are not forecasts.</strong> The RTS Link has not opened; border clearance times vary by hour and day; autonomous-feeder and parking-conversion
                parameters are illustrative.
              </li>
            </ul>
          </Section>

          <Section id="reproduce" title="Reproduce">
            <p>The full pipeline runs on a laptop. Raw data are downloaded with checksums; everything else is derived.</p>
            <pre className="code">
              {`make setup            # Python env + web dependencies
make data             # download sources (writes data/provenance.json)
make pipeline         # networks → access → form → scenarios → summary → export
make web              # build the static site into web/dist
make test             # pytest + vitest`}
            </pre>
            <p className="small muted">
              Stages can be run individually: <code>python -m sgjb.pipeline networks features population access access_overture form scenarios summary export basemap</code>.
            </p>
          </Section>

          <Section id="architecture" title="Architecture">
            <p>
              <strong>Static-first.</strong> A Python pipeline (pyosmium, GeoPandas, H3, numba-compiled Dijkstra) writes compact columnar binary tables, JSON and a tiled street
              graph; the site is plain static files that any web server or CDN can host. There is no runtime server and no API key.
            </p>
            <ul className="m-list">
              <li>
                <strong>Cells</strong>: per-cell residents and quantised distances (uint16 metres) for each essential and variant, decoded into typed arrays in the browser.
              </li>
              <li>
                <strong>Street graph</strong>: 0.02° tiles with tile-relative coordinates and delta-encoded geometry, loaded on demand for in-browser isochrones (the same edge
                snapping and Dijkstra as the pipeline).
              </li>
              <li>
                <strong>Basemap</strong>: a self-hosted PMTiles archive built with tippecanoe from OpenStreetMap and ESA WorldCover; MapLibre renders it, and deck.gl draws the
                analysis layers interleaved in the same WebGL context.
              </li>
            </ul>
          </Section>
        </article>
      </div>
    </div>
  );
}
