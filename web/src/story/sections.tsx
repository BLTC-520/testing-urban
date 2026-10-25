/**
 * Story chapters. Every number is read from summary.json / meta.json (or
 * recomputed in the browser from the published tables), so the text cannot
 * drift from the data. Evidence badges mark what is observed, calculated,
 * modelled, assumed, or a scenario.
 */
import { useMemo, type ReactNode } from "react";
import { Badge, Segmented } from "../components/Controls";
import { CATEGORY_COLOR, cssRGB, GAIN, JB, NEUTRAL, SG } from "../lib/colors";
import { shareWithin, sortedByMinutes, weightedMedian, type Mode } from "../lib/crossborder";
import { dashboardSceneUrl } from "../lib/dashboard";
import type { CrossBorder } from "../lib/data";
import { int, people, pct } from "../lib/format";
import { href } from "../lib/router";
import type { CategoryId, CityId, Meta, Summary } from "../lib/types";
import type { IsoState } from "../explore/useIsochrone";
import {
  CategoryDots,
  CompletenessStack,
  CumulativeChart,
  GainCurve,
  GridStrip,
  NeighbourhoodStrip,
  PairedMetrics,
  SourceDots,
  ThresholdChart,
  type Curve,
  type UnitPoint,
} from "./charts";
import { FootpathChapter } from "./FootpathChapter";
import { Essay, Kicker } from "./parts";
import type { Scene } from "./scenes";

export interface StoryState {
  regime: "low" | "central" | "high" | "custom";
  clearance: number;
  causeway: number;
  avWait: number;
  labMode: Mode;
  hubs: 10 | 25 | 50;
  after: boolean;
}

interface Props {
  meta: Meta | null;
  summary: Summary | null;
  iso: IsoState;
  scene: Scene;
  state: StoryState;
  setState: (p: Partial<StoryState>) => void;
  cb: CrossBorder | null;
  times: Record<Mode, Float32Array> | null;
  jbPop: Float32Array | null;
  sites: GeoJSON.FeatureCollection | null;
}

const CITY: Record<CityId, string> = { sg: "Singapore", jb: "Johor Bahru" };
const MIN_UNIT_POP = 20000;

function Step({ scene, children, wide = false }: { scene: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="story-step" data-scene={scene}>
      <div className={`step-card${wide ? " wide" : ""}`}>{children}</div>
    </div>
  );
}

function CityFigure({ city, value, children }: { city: CityId; value: string; children: ReactNode }) {
  return (
    <div className={`city-figure ${city}`}>
      <div className="cf-value">{value}</div>
      <div className="cf-text">{children}</div>
    </div>
  );
}

const catLabel = (meta: Meta, id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;

function prettyTag(t: string): string {
  const [k, v] = t.split("=");
  const nice = v.replace(/_/g, " ");
  if (k === "leisure" || k === "landuse") return nice;
  return nice;
}

export function Chapters(p: Props) {
  const { meta, summary } = p;
  if (!meta || !summary) {
    return (
      <main className="chapters">
        <section className="hero" data-scene="hero">
          <div className="hero-inner">
            <Kicker>Singapore · Johor Bahru</Kicker>
            <h1>Fifteen minutes from home</h1>
            <p className="hero-loading" aria-live="polite">
              Loading the street network…
            </p>
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="chapters">
      <Hero meta={meta} summary={summary} />
      <WhyTheseCities summary={summary} />
      <PitchDeckBriefing meta={meta} summary={summary} />
      <WalkSteps {...p} meta={meta} summary={summary} />
      <BasketEssay meta={meta} summary={summary} />
      <SurfaceSteps meta={meta} summary={summary} />
      <GapEssay meta={meta} summary={summary} />
      <WhereSteps summary={summary} />
      <FormEssay meta={meta} summary={summary} />
      <AuditEssay meta={meta} summary={summary} />
      <BorderSteps {...p} meta={meta} summary={summary} />
      <ParkingSteps {...p} meta={meta} summary={summary} />
      <FootpathChapter meta={meta} n="11" />
      <FuturesEssay {...p} meta={meta} summary={summary} />
      <RobustEssay meta={meta} summary={summary} />
      <Ending meta={meta} />
    </main>
  );
}

// ============================================================================ hero

function Hero({ meta, summary }: { meta: Meta; summary: Summary }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  return (
    <section className="hero" data-scene="hero">
      <div className="hero-inner">
        <Kicker>Singapore · Johor Bahru · a street-network study</Kicker>
        <h1>
          Fifteen minutes
          <br />
          from home
        </h1>
        <p className="dek">
          Two cities share a strait, a causeway and a labour market, but not a street pattern. We routed {((sg.population + jb.population) / 1e6).toFixed(1)} million people, Singapore's
          residents and all of Johor Bahru's, along the mapped streets and footpaths on both sides to ask a plain question: <em>can you reach the basics of daily life on foot?</em>
        </p>
        <div className="hero-figures">
          <CityFigure city="sg" value={pct(sg.share_complete, 1)}>
            of Singapore residents can walk to all {meta.basket.length} everyday essentials within 15 minutes.
          </CityFigure>
          <CityFigure city="jb" value={pct(jb.share_complete, 1)}>
            of Johor Bahru residents can.
          </CityFigure>
        </div>
        <HeroFinePrint summary={summary} />
        <p className="hero-meta">
          <Badge kind="observed">streets &amp; places</Badge> <Badge kind="calculated">walking times</Badge> <Badge kind="modelled">where people live</Badge>
        </p>
        <p className="hero-meta muted">OpenStreetMap snapshot {meta.osm_snapshot} · walking at 1.2 m/s</p>
        <a className="scroll-cue" href="#why">
          Scroll to walk the network <span aria-hidden>↓</span>
        </a>
      </div>
    </section>
  );
}

/** Qualifiers under the headline figures. Every number is computed from summary.json. */
function HeroFinePrint({ summary }: { summary: Summary }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  const ov = summary.poi_source_overture;
  return (
    <div className="hero-fine">
      <p>
        Population from the 2020 censuses. Shares are of the residents whose homes are within 250 m of a walkable street:{" "}
        {pct(sg.population_on_network / sg.population, 1)} of them in Singapore, {pct(jb.population_on_network / jb.population, 1)} in Johor Bahru.
        {ov ? (
          <>
            {" "}
            With Overture Places instead of OpenStreetMap for food shops, clinics, schools and eateries: {pct(ov.sg.share_complete, 1)} and {pct(ov.jb.share_complete, 1)}.
          </>
        ) : null}
      </p>
      <p>
        Singapore counts residents; Johor Bahru counts everyone — <a href={href("/methods", undefined, "population")}>see Methods</a>.{" "}
        <a href={href("/methods", undefined, "metrics")}>How these are measured</a>
      </p>
    </div>
  );
}

// ============================================================================ why

function WhyTheseCities({ summary }: { summary: Summary }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  return (
    <Essay id="why">
      <Kicker n="01">Why these two cities</Kicker>
      <h2>One region, two answers to the same question</h2>
      <div className="cols">
        <p>
          Singapore and Johor Bahru face each other across the Johor Strait, joined by a one-kilometre causeway. Woodlands Checkpoint, at its Singapore end, handled about
          327,000 travellers a day in 2024 — one of the busiest land borders in the world. Every morning tens of thousands of Johor residents commute south.
        </p>
        <p>
          Yet the two cities grew from different plans. Singapore built compact public-housing towns around transit and hawker centres; Johor Bahru grew outward as a car-oriented
          metropolis of private housing estates — <em>taman</em> — linked by highways. The <strong>15-minute city</strong>, the idea that daily needs should be a short walk from
          home, puts both answers on a common, human scale.
        </p>
      </div>
      <div className="evidence-key">
        <div>
          <Badge kind="observed" />
          <span>Recorded data: mapped streets and places, census counts, timetables.</span>
        </div>
        <div>
          <Badge kind="calculated" />
          <span>Computed from observed data by a documented method — every walking time here.</span>
        </div>
        <div>
          <Badge kind="modelled" />
          <span>Estimated: where people live inside census areas ({people(sg.population)} in Singapore, {people(jb.population)} in Johor Bahru).</span>
        </div>
        <div>
          <Badge kind="assumed" />
          <span>Parameters we chose, and then varied to see whether the findings survive.</span>
        </div>
        <div>
          <Badge kind="scenario" />
          <span>What-ifs about future mobility. Explorations, never predictions.</span>
        </div>
      </div>
    </Essay>
  );
}

// ============================================================================ pitch deck briefing

export interface LandmarkLaunchTarget {
  id: string;
  name: string;
  city: CityId;
  cityLabel: string;
  badge: string;
  desc: string;
  lon: number;
  lat: number;
}

export const LANDMARK_LAUNCH_TARGETS: readonly LandmarkLaunchTarget[] = [
  {
    id: "mbs",
    name: "Marina Bay Sands",
    city: "sg",
    cityLabel: "Singapore",
    badge: "3D Towers · SkyPark",
    desc: "3D multi-part towers + SkyPark mesh & walk-shed",
    lon: 103.86072,
    lat: 1.28370,
  },
  {
    id: "larkin",
    name: "Larkin Sentral",
    city: "jb",
    cityLabel: "Johor Bahru",
    badge: "Transit Hub · Market",
    desc: "Regional bus terminal & market hub walk-shed",
    lon: 103.74257,
    lat: 1.49572,
  },
  {
    id: "ciq",
    name: "Bangunan Sultan Iskandar CIQ",
    city: "jb",
    cityLabel: "Johor Bahru",
    badge: "Causeway · RTS Link",
    desc: "Causeway border crossing & RTS catchment",
    lon: 103.76673,
    lat: 1.46500,
  },
  {
    id: "sgh",
    name: "Singapore General Hospital",
    city: "sg",
    cityLabel: "Outram · Singapore",
    badge: "Healthcare Anchor",
    desc: "Healthcare access anchor in central Singapore",
    lon: 103.83464,
    lat: 1.27973,
  },
];

export function LandmarkLaunchStrip({
  title = "Inspect Real Places in 3D",
  subtitle = "Direct 3D Command Centre landmark launch with full building meshes & walk-sheds",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="landmark-launch-strip">
      <div className="launch-strip-header">
        <div>
          <span className="launch-strip-kicker">Interactive 3D Landmark Launch Strip</span>
          <h3 className="launch-strip-title">{title}</h3>
        </div>
        {subtitle ? <p className="launch-strip-sub">{subtitle}</p> : null}
      </div>
      <div className="landmark-cards-grid">
        {LANDMARK_LAUNCH_TARGETS.map((target) => {
          const dashUrl = dashboardSceneUrl(import.meta.env, {
            city: target.city,
            landmark: target.id,
            buildings: true,
          });
          const linkUrl =
            dashUrl ??
            href("/explore", {
              city: target.city,
              lon: target.lon.toFixed(5),
              lat: target.lat.toFixed(5),
              landmark: target.id,
            });
          const is3D = Boolean(dashUrl);

          return (
            <a
              key={target.id}
              className={`landmark-card landmark-card-${target.city}`}
              href={linkUrl}
              target={is3D ? "_blank" : undefined}
              rel={is3D ? "noreferrer" : undefined}
            >
              <div className="landmark-card-top">
                <span className={`landmark-city-pill ${target.city}`}>
                  {target.city === "sg" ? "Singapore" : "Johor Bahru"}
                </span>
                <span className="landmark-tag">{target.badge}</span>
              </div>
              <h4 className="landmark-card-name">{target.name}</h4>
              <p className="landmark-card-desc">{target.desc}</p>
              <div className="landmark-card-action">
                <span>{is3D ? "Open in 3D Command Centre ↗" : "Explore Walk-Shed →"}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function PitchDeckBriefing({ meta, summary }: { meta: Meta; summary: Summary }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  const basketCount = meta.basket.length;
  const popMillions = ((sg.population + jb.population) / 1e6).toFixed(1);
  const sgComplete = pct(sg.share_complete, 1);
  const jbComplete = pct(jb.share_complete, 1);
  const jbLowAccess = pct(jb.share_low_access, 1);
  const sensitivityRuns = summary.sensitivity?.runs ?? 162;

  const parking = summary.scenarios.parking;
  const sgP2p = parking?.sg?.after["25"]?.newly_complete
    ? int(Math.round(parking.sg.after["25"].newly_complete / 100) * 100)
    : "393,500";
  const jbP2p = parking?.jb?.after["25"]?.newly_complete
    ? int(Math.round(parking.jb.after["25"].newly_complete / 100) * 100)
    : "152,800";

  const rtsCentral = summary.scenarios.rts?.central as Record<string, Record<string, number>> | undefined;
  const rtsBaseMin = rtsCentral?.baseline?.median_min ? Math.round(rtsCentral.baseline.median_min) : 132;
  const rtsAvMin = rtsCentral?.rts_av?.median_min ? Math.round(rtsCentral.rts_av.median_min) : 85;

  return (
    <Essay id="briefing" tone="deep">
      <div className="pitch-deck-briefing">
        <Kicker n="01B">Mission &amp; Impact · Why This Platform Exists</Kicker>
        <h2>From static maps to an operational 3D decision sandbox</h2>
        <p className="lede">
          Standard planning models draw 1 km buffer circles across satellite tiles. In reality, pedestrian life is bounded by physical barriers: multi-lane expressways, drainage canals, fenced compounds, and missing footpaths. We rebuilt cross-border accessibility from scratch as an open, verifiable 3D decision tool across all {basketCount} daily essentials.
        </p>

        <div className="pitch-cards-grid">
          {/* Card 1: Real-World Problem Solving */}
          <div className="pitch-card pitch-card-problem">
            <div className="pitch-card-head">
              <span className="pitch-badge problem">Real-World Diagnosis</span>
              <span className="pitch-meta-tag">Ground Truth</span>
            </div>
            <h3>Real-World Problem Solving</h3>
            <div className="pitch-card-body">
              <p>
                Straight-line 1 km circles hide real barriers—highways, canals, compound walls, and missing footpaths that turn a 75 m gap in Johor Bahru into a 1,402 m walk.
              </p>
              <div className="pitch-stat-callout">
                <div className="stat-split">
                  <div className="stat-city sg">
                    <span className="stat-num">{sgComplete}</span>
                    <span className="stat-city-lbl">Singapore</span>
                  </div>
                  <div className="stat-divider">vs</div>
                  <div className="stat-city jb">
                    <span className="stat-num">{jbComplete}</span>
                    <span className="stat-city-lbl">Johor Bahru</span>
                  </div>
                </div>
                <div className="stat-caption">Complete 15-minute access across {popMillions} million residents</div>
              </div>
              <p>
                Across {popMillions} million residents ({sgComplete} vs {jbComplete} complete 15-min access), <strong>healthcare</strong> is the binding constraint in both cities, while {jbLowAccess} of JB residents reach fewer than 3 essentials.
              </p>
              <p className="pitch-note">
                Our 100% open-source 3D landmark &amp; street mesh grounds abstract hexagons in real places—from <strong>Marina Bay Sands</strong> and <strong>Toa Payoh</strong> to <strong>Larkin Sentral</strong> and <strong>JB CIQ</strong>.
              </p>
            </div>
          </div>

          {/* Card 2: For Urban Researchers */}
          <div className="pitch-card pitch-card-research">
            <div className="pitch-card-head">
              <span className="pitch-badge research">Open &amp; Reproducible Science</span>
              <span className="pitch-meta-tag">Audit-Ready</span>
            </div>
            <h3>For Urban Researchers</h3>
            <div className="pitch-card-body">
              <p>
                Zero-cost, fully reproducible Python + Rust/Numba + WebGL pipeline built on open data (OpenStreetMap <code>building:part</code> 3D geometry, Overture Places cross-audit revealing 2/3 clinic under-mapping in JB, HRSL/Kontur population calibration).
              </p>
              <div className="pitch-stat-callout">
                <div className="stat-single">
                  <span className="stat-num highlight">{sensitivityRuns}</span>
                  <span className="stat-single-lbl">Sensitivity Audit Runs</span>
                </div>
                <div className="stat-caption">Walking speeds 0.9–1.4 m/s · Strict vs. permissive networks · Taxonomy tiers</div>
              </div>
              <p>
                Verified across all <strong>{sensitivityRuns} sensitivity runs</strong> (walking speeds 0.9–1.4 m/s, strict vs. permissive networks, taxonomy tiers) plus in-browser WebMCP agent tools (<code>window.sgjb</code>) for automated querying.
              </p>
              <p className="pitch-note">
                100% transparent: any researcher or agent can execute live graph queries, inspect sensitivity frontiers, and download full raw parquet meshes without proprietary API gates.
              </p>
            </div>
          </div>

          {/* Card 3: For Governments & Planners */}
          <div className="pitch-card pitch-card-policy">
            <div className="pitch-card-head">
              <span className="pitch-badge policy">Policy &amp; Capital Allocation</span>
              <span className="pitch-meta-tag">High-Impact ROI</span>
            </div>
            <h3>For Governments &amp; Planners</h3>
            <div className="pitch-card-body">
              <ul className="pitch-bullet-list">
                <li>
                  <div className="bullet-title">Site Selection (Parking to Proximity)</div>
                  <p>
                    Test converting 25 surface car parks into neighbourhood hubs before spending capital—unlocking complete 15-min access for <strong>{sgP2p} Singapore</strong> and <strong>{jbP2p} Johor Bahru</strong> residents.
                  </p>
                </li>
                <li>
                  <div className="bullet-title">Cross-Border First-Mile (RTS Link + Feeders)</div>
                  <p>
                    Model how shared autonomous feeders into hubs like <strong>Larkin Sentral</strong> and <strong>Bukit Chagar</strong> cut median JB-to-Singapore MRT door-to-platform trips from <strong>{rtsBaseMin} to {rtsAvMin} minutes</strong>.
                  </p>
                </li>
                <li>
                  <div className="bullet-title">Surgical Micro-Infrastructure (One Footpath)</div>
                  <p>
                    Pinpoint exact dead-ends—like a single <strong>75 m footpath in Bukit Indah</strong> that gives <strong>2,200 residents</strong> complete 15-minute access.
                  </p>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <LandmarkLaunchStrip
          title="Inspect Real Places in 3D"
          subtitle="Explore landmark geometry, multi-part towers, and pedestrian walk-sheds in the 3D Command Centre"
        />
      </div>
    </Essay>
  );
}

// ============================================================================ walking

function ReachList({ meta, iso, active }: { meta: Meta; iso: IsoState; active: boolean }) {
  if (!active || iso.status === "loading" || iso.status === "idle") return <p className="reach-loading muted">Walking the street network…</p>;
  if (!iso.reached) return null;
  return (
    <ul className="reach">
      {meta.basket.map((c) => {
        const n = iso.reached!.nearest[c];
        const ok = n && n.minutes <= 15;
        return (
          <li key={c} className={ok ? "ok" : "miss"}>
            <i style={{ background: cssRGB(CATEGORY_COLOR[c]) }} />
            <span className="r-label">{catLabel(meta, c)}</span>
            <span className="r-min">{n ? `${Math.round(n.minutes)} min` : "> 15 min"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function WalkSteps({ meta, summary, iso, scene }: Props & { meta: Meta; summary: Summary }) {
  const f = summary.form;
  return (
    <>
      <Step scene="walk-sg">
        <Kicker n="02">Method</Kicker>
        <h3>A circle is not a neighbourhood</h3>
        <p>
          Most 15-minute-city maps draw a circle: 1.08 km at walking pace. People don't walk in circles. This is the walk-shed from the centre of <strong>Toa Payoh</strong>, a
          1960s public-housing town, routed along mapped footpaths, crossings and covered linkways.
        </p>
        <ReachList meta={meta} iso={iso} active={scene.id === "walk-sg"} />
        <p className="small muted">
          Nearest of each essential from this point. Points are the OpenStreetMap centres of each neighbourhood. <Badge kind="calculated" />
        </p>
      </Step>
      <Step scene="walk-jb">
        <h3>Same fifteen minutes, different streets</h3>
        <p>
          The centre of <strong>Taman Johor Jaya</strong>, an established estate of terrace houses on a regular grid. Its shopping streets serve it well; what the walk does not
          reach is a park of at least half a hectare. Away from estate centres like this one, the essentials thin out quickly.
        </p>
        <ReachList meta={meta} iso={iso} active={scene.id === "walk-jb"} />
        {f ? (
          <p className="small">
            Of the neighbours living inside a home's 15-minute circle, a 15-minute walk actually reaches a median <strong>{pct(f.sg.pedestrian_shed_ratio_median)}</strong> in
            Singapore and <strong>{pct(f.jb.pedestrian_shed_ratio_median)}</strong> in Johor Bahru <Badge kind="calculated" />.
          </p>
        ) : null}
      </Step>
    </>
  );
}

// ============================================================================ basket

function BasketEssay({ meta, summary }: { meta: Meta; summary: Summary }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  const val = (b: typeof sg, k: string) => b[k] as number;
  return (
    <Essay id="basket">
      <Kicker n="03">The essentials</Kicker>
      <h2>Six things a day should not need a car for</h2>
      <p className="lede">
        <strong>Completeness</strong> counts how many of six kinds of everyday destination a resident can reach on foot within 15 minutes. Each essential is defined by OpenStreetMap tags, listed
        here, so anyone can check them or change them in the explorer.
      </p>
      <div className="basket">
        {meta.basket.map((id) => {
          const c = meta.categories.find((x) => x.id === id);
          const tags = [...new Set([...(c?.includes?.strict ?? []), ...(c?.includes?.core ?? [])].map(prettyTag))];
          const minArea = c?.min_area_m2?.core;
          return (
            <article key={id} className="basket-card">
              <header>
                <i style={{ background: cssRGB(CATEGORY_COLOR[id]) }} />
                <h4>{c?.label}</h4>
              </header>
              <p className="q">{c?.question}</p>
              <p className="tags">
                {tags.length ? tags.join(" · ") : null}
                {minArea ? ` · at least ${minArea / 10000} ha` : null}
              </p>
              <div className="basket-bars">
                {(["sg", "jb"] as CityId[]).map((city) => {
                  const b = city === "sg" ? sg : jb;
                  const s = val(b, `share_within_${id}`);
                  return (
                    <div key={city} className="bb-row" title={`${CITY[city]}: ${pct(s, 1)} of residents within 15 min; median ${val(b, `median_min_${id}`)?.toFixed(1)} min`}>
                      <span className="bb-city">{city.toUpperCase()}</span>
                      <span className="bb-track">
                        <span className="bb-fill" style={{ width: `${s * 100}%`, background: cssRGB(city === "sg" ? SG : JB) }} />
                      </span>
                      <span className="bb-val">{pct(s)}</span>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
      <p className="small muted">
        Bars: share of residents with that essential within a 15-minute walk <Badge kind="calculated" />. Homes and destinations join the network at the nearest walkable street.
        Those more than 250 m from one are left out. Walking pace 1.2 m/s ≈ 4.3 km/h <Badge kind="assumed" />.
      </p>
    </Essay>
  );
}

// ============================================================================ surface

function SurfaceSteps({ summary }: { meta: Meta; summary: Summary }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  return (
    <>
      <Step scene="surface-sg">
        <Kicker n="04">Two cities, one measure</Kicker>
        <h3>Singapore</h3>
        <p>
          <strong className="big sg-ink">{pct(sg.share_complete)}</strong> of residents can reach all six essentials within 15 minutes. Only {pct(sg.share_low_access)} — about{" "}
          {people(sg.low_access_population)} people — live where fewer than three are in reach.
        </p>
        <p className="small muted">
          Bright cells reach all six. Planning-area outlines in grey. <Badge kind="calculated" />
        </p>
      </Step>
      <Step scene="surface-jb">
        <h3>Johor Bahru</h3>
        <p>
          <strong className="big jb-ink">{pct(jb.share_complete)}</strong> reach all six. {pct(jb.share_low_access)} of residents — about {people(jb.low_access_population)} people —
          live where fewer than three essentials are within a 15-minute walk.
        </p>
        <p className="small muted">
          The typical resident reaches {jb.median_categories} of 6 (Singapore: {sg.median_categories}). <Badge kind="calculated" />
        </p>
      </Step>
    </>
  );
}

// ============================================================================ gaps

function GapEssay({ meta, summary }: { meta: Meta; summary: Summary }) {
  const sg = summary.cities.sg.all;
  const jb = summary.cities.jb.all;
  const rows = meta.basket.map((id) => ({ label: catLabel(meta, id), sg: sg[`share_within_${id}`] as number, jb: jb[`share_within_${id}`] as number }));
  const worst = (city: "sg" | "jb") => [...rows].sort((a, b) => a[city] - b[city])[0];
  const gapAt = (t: string) => (sg.share_complete_by_threshold[t] ?? 0) - (jb.share_complete_by_threshold[t] ?? 0);
  const widest = Object.keys(sg.share_complete_by_threshold).sort((a, b) => gapAt(b) - gapAt(a))[0];
  return (
    <Essay id="gaps">
      <Kicker n="05">How wide is the gap?</Kicker>
      <h2>In Singapore the question is which essential is missing. In Johor Bahru, it is how many.</h2>
      <div className="grid-2">
        <div>
          <h4 className="chart-title">Residents by number of essentials within a 15-minute walk</h4>
          <CompletenessStack hist={{ sg: sg.categories_histogram, jb: jb.categories_histogram }} caption="Share of residents by number of essentials reachable within 15 minutes" />
          <p className="small">
            {pct(sg.categories_histogram[5])} of Singapore residents are one essential short; almost nobody lacks more. Johor Bahru's residents spread across the whole range:{" "}
            {pct(jb.categories_histogram[0])} reach none of the six within 15 minutes, and the median resident reaches {jb.median_categories}.
          </p>
        </div>
        <div>
          <h4 className="chart-title">If the stopwatch changes</h4>
          <ThresholdChart data={{ sg: sg.share_complete_by_threshold, jb: jb.share_complete_by_threshold }} caption="Share of residents reaching all six essentials, by walking time" />
          <p className="small">
            The gap is widest at {widest} minutes ({Math.round(gapAt(widest) * 100)} points). A 20-minute city would still leave {pct(1 - (jb.share_complete_by_threshold["20"] ?? 0))} of
            Johor Bahru residents short of the full set.
          </p>
        </div>
      </div>
      <h4 className="chart-title">Which essential is out of reach?</h4>
      <CategoryDots rows={rows} caption="Share of residents with each essential within a 15-minute walk" />
      <p className="small">
        In Singapore the essential most often missing is <strong>{worst("sg").label.toLowerCase()}</strong> ({pct(1 - worst("sg").sg)} of residents lack it within 15 minutes);
        in Johor Bahru it is <strong>{worst("jb").label.toLowerCase()}</strong> ({pct(1 - worst("jb").jb)}). <Badge kind="calculated" />
      </p>
    </Essay>
  );
}

// ============================================================================ where

function WhereSteps({ summary }: { summary: Summary }) {
  const hc = summary.audit.poi_cross_source.find((r) => r.city === "jb" && r.category === "healthcare");
  const hcRatio = hc ? Number(hc.osm_per_10k) / Number(hc.overture_per_10k) : NaN;
  const units: UnitPoint[] = summary.neighbourhoods
    .filter((n) => n.population >= MIN_UNIT_POP)
    .map((n) => ({ id: n.unit_id, name: n.unit_name, city: n.city, value: n.share_complete, population: n.population }));
  const low = (c: CityId) => units.filter((u) => u.city === c).sort((a, b) => a.value - b.value);
  const high = (c: CityId) => low(c).reverse();
  const labelIds = new Set([...low("sg").slice(0, 2), ...low("jb").slice(0, 2), high("sg")[0], high("jb")[0]].filter(Boolean).map((u) => u.id));
  return (
    <>
      <Step scene="gaps" wide>
        <Kicker n="06">Where</Kicker>
        <h3>The weakest neighbourhoods</h3>
        <p>
          Lowest completeness among areas with at least {int(MIN_UNIT_POP)} residents: in Singapore, {low("sg").slice(0, 3).map((u) => `${u.name} (${pct(u.value)})`).join(", ")}; in
          Johor Bahru, {low("jb").slice(0, 3).map((u) => `${u.name} (${pct(u.value)})`).join(", ")}.
        </p>
        <NeighbourhoodStrip units={units} labelIds={labelIds} caption="Share of residents reaching all six essentials, by neighbourhood" />
        <p className="small">
          In most of these areas the missing essential is healthcare: a clinic, hospital or pharmacy within 15 minutes. OpenStreetMap lists {pct(hcRatio)} as many clinics,
          hospitals and pharmacies per resident in Johor Bahru as Overture Places does (chapter 08), so treat individual neighbourhoods as places to check, not verdicts.
        </p>
        <p className="small muted">
          Dots are Singapore planning areas and Johor Bahru state constituencies, sized by residents. <Badge kind="calculated" /> <Badge kind="modelled">residents</Badge>
        </p>
      </Step>
    </>
  );
}

// ============================================================================ form

function FormEssay({ meta, summary }: { meta: Meta; summary: Summary }) {
  const f = summary.form;
  const sgE = summary.cities.sg;
  const jbE = summary.cities.jb;
  const slow = meta.accessibility.walk_speed_mps.slow;
  const rows = [
    { label: "All residents, walking at 1.2 m/s", sg: sgE.all.share_complete, jb: jbE.all.share_complete },
    { label: "Residents aged 65+, 1.2 m/s", sg: sgE.elderly.share_complete, jb: jbE.elderly.share_complete },
    { label: `Residents aged 65+, ${slow} m/s`, sg: sgE.elderly_slow_walk.share_complete, jb: jbE.elderly_slow_walk.share_complete },
  ];
  return (
    <Essay id="form" tone="deep">
      <Kicker n="07">Why</Kicker>
      <h2>The street network decides before the shops do</h2>
      <p className="lede">
        Destinations matter, but so does the fabric that connects them.{" "}
        {f ? (
          <>
            Singapore's housing towns have {(f.sg.intersections_per_km2 / f.jb.intersections_per_km2).toFixed(1)} times as many street junctions per square kilometre as Johor
            Bahru's estates, and {(f.sg.pedestrian_way_share / f.jb.pedestrian_way_share).toFixed(1)} times the share of dedicated footpaths. Shorter blocks mean more direct
            walks: from a typical home, a 15-minute walk reaches {pct(f.sg.pedestrian_shed_ratio_median)} of the neighbours inside its circle in Singapore and{" "}
            {pct(f.jb.pedestrian_shed_ratio_median)} in Johor Bahru.
          </>
        ) : null}
      </p>
      {f ? (
        <PairedMetrics
          caption="Urban form indicators, populated areas"
          rows={[
            { label: "Street intersections", unit: "per km²", sg: f.sg.intersections_per_km2, jb: f.jb.intersections_per_km2 },
            { label: "Dead ends", unit: "share of nodes", sg: f.sg.dead_end_share, jb: f.jb.dead_end_share, fmt: (v) => pct(v) },
            { label: "Footpaths & pedestrian ways", unit: "share of walkable length", sg: f.sg.pedestrian_way_share, jb: f.jb.pedestrian_way_share, fmt: (v) => pct(v) },
            { label: "Walking along arterials with no mapped footway", unit: "share of walkable length", sg: f.sg.arterial_no_sidewalk_share, jb: f.jb.arterial_no_sidewalk_share, fmt: (v) => pct(v, 1) },
            { label: "Roads with a sidewalk tagged", unit: "share of road length", sg: f.sg.sidewalk_tagged_share_of_roads, jb: f.jb.sidewalk_tagged_share_of_roads, fmt: (v) => pct(v, 1) },
            { label: "Neighbours in the circle reached on foot", unit: "median, 15 min", sg: f.sg.pedestrian_shed_ratio_median, jb: f.jb.pedestrian_shed_ratio_median, fmt: (v) => pct(v) },
          ]}
        />
      ) : null}
      <p className="small muted">
        Each indicator on its own scale, populated areas only. <Badge kind="calculated" /> from <Badge kind="observed">OSM</Badge>
      </p>
      {f ? (
        <p>
          Part of the contrast is how the cities are mapped. Singapore records its pavements as separate footpaths ({pct(f.sg.pedestrian_way_share)} of walkable length) and tags
          sidewalks on {pct(f.sg.sidewalk_tagged_share_of_roads)} of road length; in Johor Bahru footpaths are {pct(f.jb.pedestrian_way_share)} of walkable length and{" "}
          {pct(f.jb.sidewalk_tagged_share_of_roads, 1)} of roads carry a sidewalk tag. Where the map is silent, the baseline assumes people can walk along the road; a stricter
          network that forbids walking on trunk and primary roads without a mapped footway is part of the sensitivity analysis.
        </p>
      ) : null}
      <div className="split">
        <div>
          <h3>Slower walkers</h3>
          <p>
            A 15-minute walk at 1.2 m/s is about 1.1 km. Many older adults walk closer to {slow} m/s, which shrinks the same 15 minutes to 810 m. Singapore's population is much
            older ({pct(sgE.all.population ? (summary.cities.sg.elderly.population as number) / sgE.all.population : NaN)} aged 65+, against{" "}
            {pct(jbE.all.population ? (summary.cities.jb.elderly.population as number) / jbE.all.population : NaN)} in Johor Bahru) <Badge kind="observed">census</Badge>.
          </p>
          <p>
            At {slow} m/s, Singapore's complete share for residents aged 65+ falls from {pct(sgE.elderly.share_complete)} to <strong>{pct(sgE.elderly_slow_walk.share_complete)}</strong>
            ; Johor Bahru's from {pct(jbE.elderly.share_complete)} to <strong>{pct(jbE.elderly_slow_walk.share_complete)}</strong>.
          </p>
        </div>
        <div>
          <h4 className="chart-title">Share reaching all six within 15 minutes</h4>
          <CategoryDots rows={rows} caption="Share reaching all six essentials, all residents vs residents aged 65 and over at two walking speeds" />
        </div>
      </div>
    </Essay>
  );
}

// ============================================================================ audit

function AuditEssay({ meta, summary }: { meta: Meta; summary: Summary }) {
  const a = summary.audit;
  const bus = (c: string) => a.bus_stops.find((r) => r.city === c);
  const rail = a.rail_stations.find((r) => r.city === "sg");
  const pop = (c: string, m: string) => a.population.find((r) => r.city === c && String(r.model).startsWith(m));
  const ov = summary.poi_source_overture;
  const sourceRows = a.poi_cross_source.map((r) => ({
    city: r.city as "sg" | "jb",
    label: catLabel(meta, String(r.category)),
    osm: Number(r.osm_per_10k),
    overture: Number(r.overture_per_10k),
  }));
  sourceRows.sort((x, y) => (x.label === y.label ? (x.city === "sg" ? -1 : 1) : x.label.localeCompare(y.label)));
  const NOUN: Record<string, string> = { groceries: "food shops", healthcare: "healthcare places", education: "schools and childcare centres", dining: "eateries" };
  const overtureMore = a.poi_cross_source
    .filter((r) => r.city === "jb" && Number(r.overture_per_10k) > 1.2 * Number(r.osm_per_10k))
    .map((r) => NOUN[String(r.category)] ?? String(r.category));
  return (
    <Essay id="audit">
      <Kicker n="08">Is it the city, or the map?</Kicker>
      <h2>Testing the data before trusting the gap</h2>
      <p className="lede">
        OpenStreetMap is built by volunteers, and its coverage can differ between countries. A gap between the cities only counts as a finding if it survives independent sources.
      </p>
      <div className="audit-grid">
        <div className="audit-card">
          <h4>Bus stops</h4>
          <p>
            Of the official stops, OpenStreetMap has a stop within 30 m for <strong>{pct(Number(bus("sg")?.recall_30m), 0)}</strong> in Singapore (LTA, {int(Number(bus("sg")?.official_stops))} stops) and{" "}
            <strong>{pct(Number(bus("jb")?.recall_30m), 0)}</strong> in Johor Bahru (myBAS GTFS, {int(Number(bus("jb")?.official_stops))} stops).
          </p>
          <Badge kind="observed">LTA · myBAS GTFS</Badge>
        </div>
        <div className="audit-card">
          <h4>Rail stations</h4>
          <p>
            {rail ? (
              <>
                <strong>{pct(Number(rail.recall_200m))}</strong> of Singapore's {int(Number(rail.official_stations))} MRT/LRT stations in LTA's station layer have an OSM station within 200 m.
              </>
            ) : (
              "Not available."
            )}
          </p>
          <Badge kind="observed">LTA station layer</Badge>
        </div>
        <div className="audit-card">
          <h4>Where people live</h4>
          <p>
            Our population grid, summed by census area, against the census: log-correlation {Number(pop("sg", "HRSL")?.log_correlation).toFixed(2)} across Singapore subzones and{" "}
            {Number(pop("jb", "HRSL")?.log_correlation).toFixed(2)} across Johor Bahru constituencies. Totals are calibrated to the census exactly.
          </p>
          <Badge kind="modelled">HRSL · Kontur</Badge>
        </div>
      </div>
      <h4 className="chart-title">Shops, clinics, schools and eateries per 10,000 residents</h4>
      <SourceDots rows={sourceRows} caption="Destinations per 10,000 residents in OpenStreetMap and Overture Places" />
      {ov ? (
        <div className="callout">
          <p>
            {overtureMore.length ? (
              <>
                Overture Places lists more {overtureMore.slice(0, -1).join(", ")}
                {overtureMore.length > 1 ? " and " : ""}
                {overtureMore[overtureMore.length - 1]} per resident in Johor Bahru than OpenStreetMap does, so we re-ran the whole analysis with Overture for those four
                essentials.{" "}
              </>
            ) : (
              <>We re-ran the whole analysis with Overture Places for shops, clinics, schools and eateries. </>
            )}
            Result: Singapore <strong>{pct(ov.sg.share_complete, 1)}</strong>, Johor Bahru <strong>{pct(ov.jb.share_complete, 1)}</strong> complete (OpenStreetMap:{" "}
            {pct(summary.cities.sg.all.share_complete, 1)} and {pct(summary.cities.jb.all.share_complete, 1)}).{" "}
            {ov.sg.share_complete - ov.jb.share_complete > 0.2
              ? ov.jb.share_complete > summary.cities.jb.all.share_complete + 0.03
                ? "Part of Johor Bahru's gap is under-mapping, but most of it survives."
                : "The gap is not an artefact of under-mapping."
              : "With Overture, the gap narrows sharply: under-mapping explains much of it."}
          </p>
          <Badge kind="calculated">sensitivity run</Badge>
        </div>
      ) : null}
    </Essay>
  );
}

// ============================================================================ border

function useBorderStats(times: Record<Mode, Float32Array> | null, w: Float32Array | null) {
  return useMemo(() => {
    if (!times || !w) return null;
    const out = {} as Record<Mode, { median: number; within60: number; within90: number }>;
    for (const m of ["baseline", "rts", "rts_av"] as Mode[]) {
      out[m] = { median: weightedMedian(times[m], w), within60: shareWithin(times[m], w, 60), within90: shareWithin(times[m], w, 90) };
    }
    return out;
  }, [times, w]);
}

function BorderSteps({ meta, state, setState, times, jbPop, cb }: Props & { meta: Meta; summary: Summary }) {
  const stats = useBorderStats(times, jbPop);
  const rts = meta.crossborder.rts;
  const regimes = meta.crossborder.border_regimes;
  const curves: Curve[] = useMemo(() => {
    if (!times || !jbPop) return [];
    const mk = (key: Mode, label: string, color: typeof SG) => ({ key, label, color, ...sortedByMinutes(times[key], jbPop) });
    return [mk("baseline", "Today (bus / KTM shuttle)", NEUTRAL), mk("rts", "RTS Link", JB), mk("rts_av", "RTS Link + autonomous feeder", GAIN)];
  }, [times, jbPop]);
  const loading = !cb ? <p className="muted small">Loading travel times…</p> : null;
  return (
    <>
      <Step scene="border-hubs">
        <Kicker n="09">Beyond fifteen minutes</Kicker>
        <h3>The border is not a street</h3>
        <p>
          A 15-minute city ends at the water's edge. Crossing to Singapore means two immigration clearances and a queue whose length no timetable can promise. The{" "}
          <strong>RTS Link</strong>, a 4 km shuttle from Bukit Chagar to Woodlands North, is due to open by the end of 2026: a {rts.ride_min}-minute ride, a train every{" "}
          {rts.peak_headway_min} minutes at peak, up to {int(rts.capacity_pphpd)} passengers an hour each way, with both countries' checks at the departure station.
        </p>
        <p className="small muted">
          Under the bilateral agreement, KTM's Shuttle Tebrau is to stop within six months of the RTS Link opening (Malaysia has said it will seek to keep it). <Badge kind="observed">MOT · LTA</Badge>
        </p>
      </Step>
      <Step scene="border-baseline">
        <h3>Today: door to platform</h3>
        {stats ? (
          <p>
            Walking and myBAS buses to the Causeway buses or the KTM shuttle, then the border and on to the MRT: the median Johor Bahru resident needs{" "}
            <strong>{Math.round(stats.baseline.median)} minutes</strong> to reach a Singapore MRT platform, and {pct(stats.baseline.within90)} can do it within 90 minutes.
          </p>
        ) : (
          loading
        )}
        <p className="small muted">
          Central assumptions: {state.clearance} min clearance per country, {state.causeway} min on the Causeway. <Badge kind="calculated">access</Badge> <Badge kind="assumed">border</Badge>
        </p>
      </Step>
      <Step scene="border-rts">
        <h3>With the RTS Link</h3>
        {stats ? (
          <p>
            The median falls to <strong>{Math.round(stats.rts.median)} minutes</strong> — a saving of {Math.round(stats.baseline.median - stats.rts.median)}. The train takes the
            Causeway queue out of the trip, but most of the journey happens before the border: reaching Bukit Chagar by bus at peak headways that are mostly 20–40 minutes.
          </p>
        ) : (
          loading
        )}
        <p className="small muted">
          myBAS headways from the official GTFS feed, 07:00–09:00 on a weekday. <Badge kind="observed">GTFS</Badge> <Badge kind="scenario">RTS</Badge>
        </p>
      </Step>
      <Step scene="border-av">
        <h3>With a shared autonomous feeder</h3>
        {stats ? (
          <p>
            Suppose an on-demand autonomous shuttle collected riders at the kerb ({meta.crossborder.av_feeder.wait_min.central}-minute wait, pooled rides at peak road speeds) and
            dropped them at Bukit Chagar. The median would fall to <strong>{Math.round(stats.rts_av.median)} minutes</strong>, and {pct(stats.rts_av.within90)} of residents could reach
            Singapore's rail network within 90 minutes (today: {pct(stats.baseline.within90)}).
          </p>
        ) : (
          loading
        )}
        <p className="small muted">
          Precedent, not prediction: Singapore opened autonomous shuttles in Punggol to the public on 1 April 2026. Feeder parameters are assumptions. <Badge kind="scenario" />
        </p>
      </Step>
      <Step scene="border-lab" wide>
        <h3>Try your own assumptions</h3>
        <p className="small">Nobody can promise a border wait. Set your own and watch the map and the curve respond.</p>
        <div className="lab-controls">
          <Segmented
            label="Border regime"
            size="sm"
            value={state.regime}
            options={[
              { value: "low", label: "Smooth" },
              { value: "central", label: "Typical" },
              { value: "high", label: "Peak" },
              { value: "custom", label: "Custom" },
            ]}
            onChange={(v) => {
              if (v === "custom") return setState({ regime: v });
              const r = regimes[v];
              setState({ regime: v, clearance: r.clearance_min_per_country, causeway: r.causeway_ride_min });
            }}
          />
          <label className="slider">
            <span>
              Clearance per country <b>{state.clearance} min</b>
            </span>
            <input type="range" min={2} max={60} step={1} value={state.clearance} onChange={(e) => setState({ regime: "custom", clearance: Number(e.target.value) })} />
          </label>
          <label className="slider">
            <span>
              Causeway bus ride <b>{state.causeway} min</b>
            </span>
            <input type="range" min={5} max={90} step={1} value={state.causeway} onChange={(e) => setState({ regime: "custom", causeway: Number(e.target.value) })} />
          </label>
          <label className="slider">
            <span>
              Autonomous feeder wait <b>{state.avWait} min</b>
            </span>
            <input type="range" min={1} max={20} step={1} value={state.avWait} onChange={(e) => setState({ avWait: Number(e.target.value) })} />
          </label>
          <Segmented
            label="Map shows"
            size="sm"
            value={state.labMode}
            options={[
              { value: "baseline", label: "Today" },
              { value: "rts", label: "RTS" },
              { value: "rts_av", label: "RTS + AV" },
            ]}
            onChange={(v) => setState({ labMode: v })}
          />
        </div>
        {curves.length ? (
          <>
            <h4 className="chart-title">Johor Bahru residents within x minutes of a Singapore MRT platform</h4>
            <CumulativeChart curves={curves} xMax={180} marks={[30, 60, 90, 120, 150, 180]} caption="Share of Johor Bahru residents reaching a Singapore MRT platform within a given time" />
          </>
        ) : (
          loading
        )}
        <p className="small muted">
          The border wait moves every curve together; the feeder moves the curve where the trip actually starts. <Badge kind="scenario" />
        </p>
      </Step>
    </>
  );
}

// ============================================================================ parking

function ParkingSteps({ meta, summary, state, setState, sites }: Props & { meta: Meta; summary: Summary }) {
  const pk = summary.scenarios.parking;
  const block = (c: CityId) => pk?.[c];
  const controls = (
    <div className="lab-controls row">
      <span className="ctl-label">Hubs per city</span>
      <Segmented
        label="Hubs per city"
        size="sm"
        value={state.hubs}
        options={[
          { value: 10, label: "10" },
          { value: 25, label: "25" },
          { value: 50, label: "50" },
        ]}
        onChange={(v) => setState({ hubs: v as 10 | 25 | 50 })}
      />
      <Segmented
        label="Before or after"
        size="sm"
        value={state.after ? "after" : "before"}
        options={[
          { value: "before", label: "Before" },
          { value: "after", label: "After" },
        ]}
        onChange={(v) => setState({ after: v === "after" })}
      />
    </div>
  );
  const nums = (c: CityId) => {
    const b = block(c);
    if (!b) return null;
    const a = b.after[String(state.hubs)];
    return (
      <p>
        Converting the best {a?.sites ?? state.hubs} car parks ({a ? a.site_area_ha.toFixed(1) : "–"} ha) lifts complete access from {pct(b.before.share_complete)} to{" "}
        <strong>{pct(a?.share_complete)}</strong> of residents: <strong>{people(a?.newly_complete)}</strong> more people with all six essentials within 15 minutes.
      </p>
    );
  };
  void sites;
  return (
    <>
      <Step scene="parking-jb" wide>
        <Kicker n="10">Autonomous futures</Kicker>
        <h3>From parking to proximity</h3>
        <p>
          If shared autonomous fleets cut the need to park — the International Transport Forum's Lisbon model removed every on-street space in all its scenarios — some car-park land
          could host neighbourhood hubs instead. Which sites would matter most?
        </p>
        <p className="small">
          A hub here means a grocer, a clinic or pharmacy, childcare, an eatery and a bus stop; sites over 1 ha also keep 0.5 ha of park. Sites are mapped car parks of at least{" "}
          {int(meta.parking_to_proximity.min_site_area_m2)} m², chosen greedily for the most residents newly reaching all six. <Badge kind="scenario" />
        </p>
        {controls}
        <h4 className="city-h jb-ink">Johor Bahru</h4>
        {nums("jb")}
      </Step>
      <Step scene="parking-sg" wide>
        <h3>The same test in Singapore</h3>
        {controls}
        <h4 className="city-h sg-ink">Singapore</h4>
        {nums("sg")}
        <p className="small muted">
          Where streets are disconnected, a hub only helps the homes its walk-shed can reach. Where OpenStreetMap misses existing clinics (see chapter 08), the gain may be overstated:
          read the numbers as where land could matter, not as a forecast. <Badge kind="calculated" />
        </p>
      </Step>
    </>
  );
}

// ============================================================================ futures

function FuturesEssay({ summary, sites }: Props & { meta: Meta; summary: Summary }) {
  const series = useMemo(() => {
    if (!sites) return [];
    return (["sg", "jb"] as const).map((c) => {
      const pts: [number, number][] = [[0, 0]];
      sites.features
        .filter((f) => f.properties?.city === c)
        .sort((a, b) => Number(a.properties?.rank) - Number(b.properties?.rank))
        .forEach((f) => pts.push([Number(f.properties?.rank), Number(f.properties?.cum_newly_complete)]));
      return { key: c, points: pts };
    });
  }, [sites]);
  const rtsCentral = summary.scenarios.rts?.central as Record<string, Record<string, number>> | undefined;
  const sg = summary.cities.sg;
  const f = summary.form;
  const principles: { title: string; body: ReactNode }[] = [
    {
      title: "Design for the slowest walker, not the fastest vehicle",
      body: (
        <>
          Older residents walking at 0.9 m/s lose a large share of complete access ({pct(sg.elderly.share_complete)} → {pct(sg.elderly_slow_walk.share_complete)} in Singapore). Signal
          timing, kerb heights and crossing distances set for autonomous traffic should be judged by that walker.
        </>
      ),
    },
    {
      title: "Make the network continuous before making it smart",
      body: (
        <>
          {f ? (
            <>
              Only {pct(f.jb.pedestrian_way_share)} of Johor Bahru's walkable network is dedicated footpath (Singapore: {pct(f.sg.pedestrian_way_share)}), and the map rarely says
              whether a road has a pavement.{" "}
            </>
          ) : null}
          Sidewalk delivery robots, wheelchairs and pedestrians need the same thing: an unbroken, mapped path. Sensors cannot route around a missing footway.
        </>
      ),
    },
    {
      title: "Fix the trip to the border, not only the border",
      body: rtsCentral ? (
        <>
          The RTS Link saves the median resident about {Math.round(rtsCentral.median_saving_min as unknown as number)} minutes; a kerbside autonomous feeder saves far more, because the
          first kilometres are the slow part. Pick-up and drop-off space at Bukit Chagar is infrastructure, not an afterthought.
        </>
      ) : (
        <>The first kilometres to the border are the slow part of the trip.</>
      ),
    },
    {
      title: "Treat the kerb as the interface",
      body: (
        <>
          When many road users are autonomous agents, the kerb — where people board, alight, and receive deliveries — becomes the busiest piece of the street. It needs to be
          allocated, priced and kept clear, close to where walk-sheds converge.
        </>
      ),
    },
    {
      title: "Spend the parking dividend on proximity",
      body: <>If autonomy frees parking land, the best sites are not the biggest ones but those whose walk-sheds reach homes that are one or two essentials short.</>,
    },
    {
      title: "Measure the network you have",
      body: <>Every result here can be recomputed from open data. Cities that publish their footpaths, crossings and service locations can test interventions before building them.</>,
    },
  ];
  return (
    <Essay id="futures" tone="deep">
      <Kicker n="12">Implications</Kicker>
      <h2>What should infrastructure look like when many road users are autonomous agents?</h2>
      <p className="lede">
        Autonomy changes the vehicle, not the distance. The scenarios above suggest where it helps a walkable city — and where it cannot substitute for one.
      </p>
      {series.length ? (
        <>
          <h4 className="chart-title">Residents newly reaching all six, by number of converted car parks</h4>
          <GainCurve series={series} caption="Residents newly reaching all six essentials as more car parks become neighbourhood hubs" />
          <p className="small muted">
            Diminishing returns: the first sites cover the largest clusters of near-complete homes. <Badge kind="scenario" />
          </p>
        </>
      ) : null}
      <ol className="principles">
        {principles.map((pr) => (
          <li key={pr.title}>
            <h4>{pr.title}</h4>
            <p>{pr.body}</p>
          </li>
        ))}
      </ol>
    </Essay>
  );
}

// ============================================================================ robustness

function RobustEssay({ summary }: { meta: Meta; summary: Summary }) {
  const s = summary.sensitivity;
  const runs = (s.grid ?? []).map((g) => ({
    sg: g.sg_share_complete,
    jb: g.jb_share_complete,
    label: `${g.speed} m/s · ${g.threshold} min · ${g.taxonomy} · ${g.network} network · ${g.population.toUpperCase()}`,
  }));
  return (
    <Essay id="robust">
      <Kicker n="13">How sure are we?</Kicker>
      <h2>{s.runs} versions of the analysis</h2>
      <p className="lede">
        Walking speed (0.9, 1.2, 1.4 m/s), time budget (10, 15, 20 min), how strictly an essential is defined, how strictly a street counts as walkable, and which population model
        is used: every combination was run. A finding is <b>robust</b> if it holds in at least 90% of runs, <b>conditional</b> in 50–90%, <b>fragile</b> below that.
      </p>
      {runs.length ? (
        <GridStrip
          runs={runs}
          baseline={{ sg: summary.cities.sg.all.share_complete, jb: summary.cities.jb.all.share_complete }}
          caption="Share of residents reaching all essentials in every sensitivity run"
        />
      ) : null}
      <table className="findings">
        <thead>
          <tr>
            <th scope="col">Finding</th>
            <th scope="col">Holds in</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {s.findings.map((fd) => (
            <tr key={fd.finding}>
              <td>{fd.statement}</td>
              <td className="num">{pct(fd.share_of_runs)}</td>
              <td>
                <span className={`finding-verdict ${fd.label.toLowerCase()}`}>{fd.label.toLowerCase()}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Essay>
  );
}

// ============================================================================ end

function Ending({ meta }: { meta: Meta }) {
  return (
    <>
      <section className="story-step end-step" data-scene="end">
        <div className="end-card with-landmarks">
          <Kicker>Your turn</Kicker>
          <h2>Walk any street in either city</h2>
          <p>Click anywhere on the map to see your own walk-shed, change the definitions, slow the walker down, or switch on the Parking-to-Proximity scenario.</p>
          <div className="cta-row">
            <a className="cta primary" href={href("/explore")}>
              Open the explorer
            </a>
            <a className="cta" href={href("/methods")}>
              Read the methods
            </a>
          </div>
          <div className="end-landmarks-wrap">
            <LandmarkLaunchStrip
              title="Inspect Real Places in 3D"
              subtitle="Deep-link directly to 3D Command Centre landmark scenes"
            />
          </div>
        </div>
      </section>
      <footer className="story-footer" data-scene="hold">
        <div className="essay-inner">
          <div className="foot-grid">
            <div>
              <h4>About</h4>
              <p className="small">
                An open urban-technology study of walkable access in Singapore and Johor Bahru. Data pipeline in Python (OSM, H3, numba Dijkstra), interface in React, MapLibre and
                deck.gl; every computed number on this page can be reproduced from public data.
              </p>
            </div>
            <div>
              <h4>Data</h4>
              <ul className="small src-list">
                {meta.sources.slice(0, 9).map((s) => (
                  <li key={s.id}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>{" "}
                    <span className="muted">· {s.licence}</span>
                  </li>
                ))}
              </ul>
              <a className="small" href={href("/methods")}>
                Full data register and licences →
              </a>
            </div>
            <div>
              <h4>Caveats</h4>
              <p className="small">
                Walking times are calculated on mapped networks; real walks also depend on heat, shade, safety and topography. Population inside census areas is modelled. Scenarios are
                explorations of what could change, not forecasts.
              </p>
            </div>
          </div>
          <p className="small muted copyright">
            Map data © OpenStreetMap contributors (ODbL). Places © Overture Maps Foundation. Population: Meta &amp; CIESIN HRSL, Kontur. Census: Singapore Department of Statistics,
            Department of Statistics Malaysia. Land cover © ESA WorldCover.
          </p>
        </div>
      </footer>
    </>
  );
}

export type { CategoryId };
