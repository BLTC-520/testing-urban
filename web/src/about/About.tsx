import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { loadMeta, loadSummary, peekMeta, peekSummary } from "../lib/data";
import { pct } from "../lib/format";
import { href } from "../lib/router";
import type { CityId, Meta, Summary } from "../lib/types";
import "./about.css";

/** Contents list; the ids are the in-page anchors. */
const CONTENTS = [
  ["contribution", "My contribution"],
  ["process", "How it was made"],
  ["decisions", "Three decisions"],
  ["checks", "How the results were checked"],
  ["tools", "Tools"],
  ["explore", "Keep reading"],
] as const;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-05" → "5 October 2026" */
function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/**
 * Who made the study and how. Every figure is read from meta.json or
 * summary.json. The page renders only once both are loaded, so its
 * prerendered text is complete and the h1 can serve as the ready marker.
 */
export function About() {
  const [meta, setMeta] = useState<Meta | null>(peekMeta);
  const [summary, setSummary] = useState<Summary | null>(peekSummary);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadMeta().then(setMeta, () => setFailed(true));
    loadSummary().then(setSummary, () => setFailed(true));
  }, []);
  return (
    <div className="about">
      <Header path="/about" />
      {meta && summary ? (
        <AboutContent meta={meta} summary={summary} />
      ) : (
        <p className="about-loading">{failed ? "The published data could not be loaded." : "Loading…"}</p>
      )}
    </div>
  );
}

function AboutContent({ meta, summary }: { meta: Meta; summary: Summary }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  const shed = summary.form;
  const overture = summary.poi_source_overture;
  const byCity = (rows: Record<string, number | string>[], city: CityId) => rows.find((r) => r.city === city);
  const busSg = byCity(summary.audit.bus_stops, "sg");
  const busJb = byCity(summary.audit.bus_stops, "jb");
  const railSg = byCity(summary.audit.rail_stations, "sg");

  return (
    <main className="about-layout">
      <nav className="about-toc" aria-label="Contents">
        <div className="eyebrow">On this page</div>
        <ol>
          {CONTENTS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="about-body">
        <header className="about-head">
          <div className="eyebrow">About</div>
          <h1>Who made this, and how</h1>
          <p className="lede">This page says who made the study, how it was built, the decisions that shaped it and how its results were checked.</p>
        </header>

        <section id="contribution" className="about-section">
          <h2>My contribution</h2>
          <div className="credit">
            <p className="credit-name">
              <a href="https://brianhar.site" target="_blank" rel="noreferrer">
                Brian Har
              </a>
            </p>
            <p>
              <strong>Role.</strong> Concept and brief, research questions, choice of cities and scenarios, design direction, and review of the results.
            </p>
            <p>Built with Claude Code, an AI coding assistant, which wrote the pipeline and the site under my direction.</p>
            <p>
              <strong>Dates.</strong> October 2026 (OpenStreetMap snapshot {longDate(meta.osm_snapshot)}; first public release 14 October 2026).
            </p>
            <p>
              <strong>Source code.</strong>{" "}
              <a href="https://github.com/BLTC-520/testing-urban" target="_blank" rel="noreferrer">
                github.com/BLTC-520/testing-urban
              </a>
            </p>
          </div>
        </section>

        <section id="process" className="about-section">
          <h2>How it was made</h2>
          <p>
            The study was designed around one sentence from the case study: <em>a reader should feel the difference between a circle and a walk.</em> The work ran in these
            stages.
          </p>
          <ol className="about-steps">
            <li>
              <strong>Brief and questions.</strong> How far everyday essentials are from home on foot, in two cities that share a strait, and how future mobility could change
              that.
            </li>
            <li>
              <strong>Open data, with checksums.</strong> Each source is recorded with its SHA-256 checksum and retrieval time in <code>data/provenance.json</code>.
            </li>
            <li>
              <strong>Street network and population model.</strong> A walkable network from OpenStreetMap, and census residents placed in hexagons.
            </li>
            <li>
              <strong>Accessibility for every inhabited hexagon.</strong> A walking distance to each of six essentials, and the share with all six in reach at each walking
              speed and time budget.
            </li>
            <li>
              <strong>Validation.</strong> Against official data and a second places source: bus stops and rail stations, and OpenStreetMap places against Overture Places.
            </li>
            <li>
              <strong>Sensitivity analysis.</strong> A {summary.sensitivity.runs}-run analysis over walking speed, time budget, definitions, network rules and population model.
            </li>
            <li>
              <strong>Scenarios.</strong> The RTS Link, a shared autonomous feeder, car parks converted into neighbourhood hubs, and one new footpath in a named Johor Bahru
              neighbourhood.
            </li>
            <li>
              <strong>The site.</strong> Story, Explorer and Methods, all drawn from the same published data.
            </li>
            <li>
              <strong>Release.</strong> GitHub Pages, under a custom domain.
            </li>
            <li>
              <strong>Readable without JavaScript.</strong> Prerendered pages and an <code>llms.txt</code> guide, so search engines and AI assistants can read the study.
            </li>
            <li>
              <strong>Revisions after a teacher's review.</strong> The review asked for a clearer account of my role, the decisions and the development process; for pages
              that stay readable when the interactive map cannot run; for the qualifications beside the headline figures; for wording that claims no more than is measured;
              and for one detailed intervention in a named neighbourhood.
            </li>
          </ol>
        </section>

        <section id="decisions" className="about-section">
          <h2>Three decisions</h2>
          <p>Three choices shaped the results most. For each, the card gives the decision, the alternatives considered, why this one was chosen and what it costs.</p>

          <article className="decision">
            <h3>Measure walks on the street network, not circles</h3>
            <p>
              Distances are walked on the OpenStreetMap street and footpath network. Homes and destinations join it at the nearest point on the nearest walkable edge, not
              the nearest node. The off-network leg counts at 1.3 × its straight-line length, and nothing joins from more than 250 m. One multi-source Dijkstra search per
              essential serves every walking speed.
            </p>
            <p>
              <strong>Alternatives.</strong> Straight-line buffers (the 1.08 km “15-minute circle”), or snapping to the nearest node.
            </p>
            <p>
              <strong>Why this one.</strong> Circles overstate access where streets are discontinuous. A 15-minute walk reaches a median of only{" "}
              {pct(shed?.sg.pedestrian_shed_ratio_median)} (Singapore) and {pct(shed?.jb.pedestrian_shed_ratio_median)} (Johor Bahru) of the residents living inside a home's
              circle.
            </p>
            <p>
              <strong>Trade-off.</strong> Results depend on how completely OpenStreetMap maps footpaths and crossings. Slope, heat, shade and crossing waits are not modelled.
              A stricter network variant is part of the sensitivity analysis.
            </p>
          </article>

          <article className="decision">
            <h3>Place people with census totals and a settlement map</h3>
            <p>
              Census counts (Singapore subzones, Johor Bahru state constituencies) are spread over the hexagons in proportion to Meta/CIESIN HRSL settlement weights, with
              Kontur weights where HRSL sees no settlement. Totals therefore match the census exactly.
            </p>
            <p>
              <strong>Alternatives.</strong> Spreading people evenly over each census unit, which puts residents in forests and industrial land; or using a gridded population
              layer directly, which does not match census totals.
            </p>
            <p>
              <strong>Why this one.</strong> The census is authoritative for how many people there are; the settlement layer is better for where they live.
            </p>
            <p>
              <strong>Trade-off.</strong> Placement within each unit is modelled. The <a href={href("/methods", undefined, "population")}>Methods page</a> reports how well
              each model matches census units, and the Kontur model is an alternative in the sensitivity analysis.
            </p>
          </article>

          <article className="decision">
            <h3>A static site that computes in the browser</h3>
            <p>
              The Python pipeline precomputes compact binary tables and a tiled street graph. The browser recomputes completeness for any assumption and runs the walk-shed
              searches itself. There is no server, database or API key. The site is hosted free on GitHub Pages and prerendered for readers without JavaScript.
            </p>
            <p>
              <strong>Alternatives.</strong> A server with a spatial database and a routing engine.
            </p>
            <p>
              <strong>Why this one.</strong> Nothing to keep running or pay for, the published numbers are frozen and reproducible, and it loads fast.
            </p>
            <p>
              <strong>Trade-off.</strong> Readers download the data files and basemap tiles the pages need, tens of megabytes for the Explorer. Updating the analysis means re-running the pipeline. The interactive maps need WebGL,
              and without it the site falls back to still images and a table.
            </p>
          </article>
        </section>

        <section id="checks" className="about-section">
          <h2>How the results were checked</h2>
          <ul className="about-list">
            <li>
              Unit tests of the shortest-path code: the Python kernels against SciPy's reference Dijkstra, and the TypeScript search against a naive O(n²) reference
              (pytest and vitest).
            </li>
            <li>
              Cross-language tests (vitest): the browser decodes the Python-written tables, routes on the Python-written street tiles, and mirrors the Python metrics.
            </li>
            <li>
              Audits against official data. Official bus stops with an OpenStreetMap stop within 30 m: {pct(Number(busSg?.recall_30m))} in Singapore (LTA DataMall) and{" "}
              {pct(Number(busJb?.recall_30m))} in Johor Bahru (myBAS). Official rail stations with one within 200 m: {pct(Number(railSg?.recall_200m))} in Singapore (LTA).
            </li>
            <li>
              A full re-run with Overture Places as the destination source. All six essentials within 15 minutes: {pct(overture?.sg.share_complete, 1)} of Singapore residents
              and {pct(overture?.jb.share_complete, 1)} of Johor Bahru residents, against {pct(sg.share_complete, 1)} and {pct(jb.share_complete, 1)} with OpenStreetMap.
            </li>
            <li>{summary.sensitivity.runs} sensitivity runs, with each finding labelled robust, conditional or fragile.</li>
            <li>End-to-end checks of the built site: the prerendered pages, the Markdown and llms.txt copies, the URLs and the agent tools.</li>
          </ul>
        </section>

        <section id="tools" className="about-section">
          <h2>Tools</h2>
          <p>Python (NumPy, numba, GeoPandas, pyosmium), TypeScript, React, MapLibre GL, deck.gl, KaTeX, Playwright, Claude Code.</p>
        </section>

        <section id="explore" className="about-section">
          <h2>Keep reading</h2>
          <p>
            Start with the <a href={href("/")}>Story</a>, try the <a href={href("/explore")}>Explorer</a>, or check every formula and source on the{" "}
            <a href={href("/methods")}>Methods</a> page.
          </p>
        </section>
      </article>
    </main>
  );
}
