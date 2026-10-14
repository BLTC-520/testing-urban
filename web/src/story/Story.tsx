import type { Layer } from "@deck.gl/core";
import { GeoJsonLayer } from "@deck.gl/layers";
import { useEffect, useMemo, useRef, useState } from "react";
import { Header } from "../components/Header";
import { useIsochrone } from "../explore/useIsochrone";
import { useHexData, useSurfaces, type SurfaceParams } from "../explore/useSurface";
import { aggregate, categoriesReached, NO_DATA, type Aggregate } from "../lib/access";
import { doorToPlatform, type Mode } from "../lib/crossborder";
import { loadCrossBorder, loadNeighbourhoods, loadParkingSites, loadScenario, loadMeta, loadSummary, type CrossBorder } from "../lib/data";
import type { CityId, Meta, Summary } from "../lib/types";
import { hexLayer, isochroneLayer, markerLayer } from "../map/layers";
import { MapKey } from "./MapKey";
import { SCENES, type Scene } from "./scenes";
import { Chapters, type StoryState } from "./sections";
import "./story.css";
import { StoryMap, type MapLabel } from "./StoryMap";
import { circleLayer, gainHexLayer, hubsLayer, regionalHexLayer, sitesLayer, type SitePoint } from "./storyLayers";
import { useActiveStep } from "./useActiveStep";

const BASELINE: SurfaceParams = {
  metric: "complete",
  threshold: 15,
  speed: "base",
  people: "all",
  taxonomy: "core",
  network: "permissive",
  poiSource: "osm",
  scenario: "none",
};

function useMedia(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

export function Story() {
  const root = useRef<HTMLDivElement>(null);
  const mobile = useMedia("(max-width: 760px)");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [units, setUnits] = useState<GeoJSON.FeatureCollection | null>(null);
  const [cb, setCb] = useState<CrossBorder | null>(null);
  const [scenario, setScenario] = useState<Partial<Record<CityId, Record<string, Float32Array>>>>({});
  const [sites, setSites] = useState<GeoJSON.FeatureCollection | null>(null);
  const [state, setState] = useState<StoryState>({
    regime: "central",
    clearance: 15,
    causeway: 20,
    avWait: 6,
    labMode: "rts_av",
    hubs: 25,
    after: true,
  });

  useEffect(() => {
    loadMeta().then((m) => {
      setMeta(m);
      const r = m.crossborder.border_regimes.central;
      setState((s) => ({ ...s, clearance: r.clearance_min_per_country, causeway: r.causeway_ride_min, avWait: m.crossborder.av_feeder.wait_min.central }));
    });
    loadSummary().then(setSummary);
    loadNeighbourhoods().then(setUnits);
  }, []);

  const active = useActiveStep(root, [summary !== null]);
  const lastScene = useRef<Scene>(SCENES.hero);
  const scene = active.scene === "hold" ? lastScene.current : (SCENES[active.scene] ?? SCENES.hero);
  lastScene.current = scene;

  // lazy data for the later chapters (fetched once the reader gets close)
  const wantBorder = active.scene.startsWith("border") || active.index >= 8;
  const wantParking = active.scene.startsWith("parking") || active.index >= 12;
  useEffect(() => {
    if (wantBorder && !cb) loadCrossBorder().then(setCb);
  }, [wantBorder, cb]);
  useEffect(() => {
    if (!wantParking || sites) return;
    loadParkingSites().then(setSites);
    (["sg", "jb"] as CityId[]).forEach((c) => loadScenario(c).then((d) => setScenario((p) => ({ ...p, [c]: d }))));
  }, [wantParking, sites]);

  const surfaces = useSurfaces(meta, BASELINE);
  const sgOnly = useMemo(() => ({ sg: surfaces.sg }), [surfaces.sg]);
  const jbOnly = useMemo(() => ({ jb: surfaces.jb }), [surfaces.jb]);
  const hex8 = useHexData(surfaces, 8);
  const hexSg = useHexData(sgOnly, 9);
  const hexJb = useHexData(jbOnly, 9);
  const k = meta?.basket.length ?? 6;
  const speed = meta?.accessibility.walk_speed_mps.base ?? 1.2;

  const walkSel = useMemo(() => (scene.walk ? { lon: scene.walk.lon, lat: scene.walk.lat, city: scene.walk.city } : null), [scene.walk]);
  const iso = useIsochrone(walkSel, speed, 15, 15);

  // ---- cross-border surfaces
  const jbPop = useMemo(() => {
    if (!cb || !surfaces.jb) return null;
    const idx = new Map(surfaces.jb.cells.h3.map((h, i) => [h, i]));
    const w = new Float32Array(cb.n);
    for (let i = 0; i < cb.n; i++) {
      const j = idx.get(cb.h3[i]);
      w[i] = j === undefined ? 0 : surfaces.jb.cells.pop[j];
    }
    return w;
  }, [cb, surfaces.jb]);

  const assumptions = useMemo(
    () => ({ regime: { clearance_min_per_country: state.clearance, causeway_ride_min: state.causeway }, avWaitMin: state.avWait }),
    [state.clearance, state.causeway, state.avWait],
  );
  const borderMode: Mode | null = scene.border === "lab" ? state.labMode : (scene.border ?? null);
  const times = useMemo(() => {
    if (!cb || !meta) return null;
    const out: Record<Mode, Float32Array> = {
      baseline: doorToPlatform(cb, "baseline", assumptions, meta.crossborder),
      rts: doorToPlatform(cb, "rts", assumptions, meta.crossborder),
      rts_av: doorToPlatform(cb, "rts_av", assumptions, meta.crossborder),
    };
    return out;
  }, [cb, meta, assumptions]);
  const borderHex = useMemo(() => {
    if (!times || !cb || !jbPop || !borderMode) return null;
    return aggregate(cb.h3, times[borderMode], jbPop, 9, Infinity);
  }, [times, cb, jbPop, borderMode]);

  // ---- parking-to-proximity surfaces
  const parkingCity = scene.parking ?? null;
  const parkingHex = useMemo(() => {
    if (!parkingCity || !meta) return null;
    const sfc = surfaces[parkingCity];
    const sc = scenario[parkingCity];
    if (!sfc || !sc) return null;
    const d: Record<string, Float32Array> = {};
    for (const c of meta.basket) d[c] = sc[`${c}__p2p${state.hubs}`] ?? sfc.d[c];
    const after = categoriesReached(sfc.cells.n, d, meta.basket, speed, 15);
    const before = sfc.value;
    const gain = new Float32Array(sfc.cells.n);
    for (let i = 0; i < sfc.cells.n; i++) gain[i] = before[i] !== NO_DATA && before[i] < k && after[i] === k ? 1 : 0;
    const base = aggregate(sfc.cells.h3, before, sfc.weights, 9);
    const g = aggregate(sfc.cells.h3, state.after ? gain : new Float32Array(sfc.cells.n), sfc.weights, 9);
    const gm = new Map(g.map((x) => [x.hex, x.value]));
    return base.map((b) => ({ ...b, gain: gm.get(b.hex) ?? 0 }));
  }, [parkingCity, meta, surfaces, scenario, state.hubs, state.after, speed, k]);

  const sitePoints: SitePoint[] = useMemo(() => {
    if (!sites || !parkingCity) return [];
    return sites.features
      .filter((f) => f.properties?.city === parkingCity)
      .map((f) => ({
        lon: Number(f.properties?.lon),
        lat: Number(f.properties?.lat),
        rank: Number(f.properties?.rank),
        areaHa: Number(f.properties?.area_m2) / 1e4,
        newlyComplete: Number(f.properties?.newly_complete),
      }));
  }, [sites, parkingCity]);

  // ---- neighbourhoods to highlight (lowest completeness among populous units)
  const weakest = useMemo(() => {
    if (!summary) return [] as string[];
    const out: string[] = [];
    for (const c of ["sg", "jb"] as CityId[]) {
      summary.neighbourhoods
        .filter((n) => n.city === c && n.population >= 20000)
        .sort((a, b) => a.share_complete - b.share_complete)
        .slice(0, 3)
        .forEach((n) => out.push(n.unit_id));
    }
    return out;
  }, [summary]);

  const layers = useMemo(() => {
    const L: Layer[] = [];
    if (scene.surface === "extruded") {
      L.push(hexLayer("story-hex3d", hex8, "count", k, { extruded: true, elevationScale: mobile ? 1.6 : 1.25, opacity: 0.95, coverage: 0.9, trigger: "3d" }));
    } else if (scene.surface === "flat") {
      const dimSg = scene.focus === "jb";
      const dimJb = scene.focus === "sg";
      L.push(hexLayer("story-hex-sg", hexSg, "count", k, { opacity: dimSg ? 0.18 : 0.85, trigger: "sg" }));
      L.push(hexLayer("story-hex-jb", hexJb, "count", k, { opacity: dimJb ? 0.18 : 0.85, trigger: "jb" }));
    }
    if (scene.units && units) {
      const hi = scene.units === "highlight" ? new Set(weakest) : null;
      L.push(
        new GeoJsonLayer({
          id: "story-units",
          data: units,
          filled: false,
          stroked: true,
          getLineColor: (f: GeoJSON.Feature) => (hi?.has(String(f.properties?.unit_id)) ? [243, 239, 230, 235] : [236, 233, 226, hi ? 28 : 55]),
          getLineWidth: (f: GeoJSON.Feature) => (hi?.has(String(f.properties?.unit_id)) ? 2.2 : 0.8),
          lineWidthUnits: "pixels",
          updateTriggers: { getLineColor: [scene.units, weakest.join()], getLineWidth: [scene.units, weakest.join()] },
        }),
      );
    }
    if (scene.walk) {
      L.push(circleLayer("story-circle", [scene.walk.lon, scene.walk.lat], 15 * 60 * speed));
      if (iso.iso) L.push(isochroneLayer("story-iso", iso.iso.segments, iso.reveal, speed));
      L.push(markerLayer("story-marker", [scene.walk.lon, scene.walk.lat]));
    }
    if (borderHex) L.push(regionalHexLayer("story-border", borderHex, `${borderMode}|${state.clearance}|${state.causeway}|${state.avWait}`));
    if (scene.border !== undefined && meta) {
      const hubs = Object.entries(meta.hubs).map(([key, h]) => ({ lon: h.lon, lat: h.lat, kind: key === "rts" ? ("rts" as const) : ("other" as const) }));
      hubs.push({ ...WOODLANDS_NORTH, kind: "rts" });
      L.push(hubsLayer("story-hubs", hubs));
    }
    if (parkingHex) {
      L.push(gainHexLayer("story-parking", parkingHex, `${state.hubs}|${state.after}|${parkingCity}`));
      L.push(sitesLayer("story-sites", sitePoints, state.after ? state.hubs : 0));
    }
    return L;
  }, [scene, hex8, hexSg, hexJb, k, mobile, units, weakest, iso.iso, iso.reveal, speed, borderHex, borderMode, state, meta, parkingHex, sitePoints, parkingCity]);

  const labels: MapLabel[] = useMemo(() => {
    if (scene.walk) return [{ lon: scene.walk.lon, lat: scene.walk.lat, title: scene.walk.label.split(",")[0], sub: "15 minutes on foot from here" }];
    if (scene.id === "border-hubs" && meta) {
      const h = meta.hubs;
      const anchor = h.rts ?? h.ktm ?? h.bus;
      return [
        anchor && {
          lon: anchor.lon,
          lat: anchor.lat,
          title: "Johor Bahru border hubs",
          lines: ["Bukit Chagar · RTS Link, both countries' checks", "JB Sentral · KTM Shuttle Tebrau", "Sultan Iskandar CIQ · Causeway buses"],
          side: "right" as const,
        },
        { ...WOODLANDS_NORTH, title: "Woodlands North", sub: "RTS Link terminus · Thomson–East Coast Line" },
      ].filter(Boolean) as MapLabel[];
    }
    if (scene.units === "highlight" && units && summary) {
      return weakest
        .map((id, i) => {
          const f = units.features.find((x) => x.properties?.unit_id === id);
          const nb = summary.neighbourhoods.find((n) => n.unit_id === id);
          if (!f || !nb) return null;
          const [lon, lat] = labelPoint(f);
          return { lon, lat, title: nb.unit_name, sub: `${Math.round(nb.share_complete * 100)}% complete`, side: i % 2 ? ("left" as const) : ("right" as const) };
        })
        .filter(Boolean) as MapLabel[];
    }
    return [];
  }, [scene, meta, units, summary, weakest]);

  return (
    <div className="story" ref={root}>
      <Header path="/" overlay />
      <StoryMap scene={scene} layers={layers} labels={labels} mobile={mobile} />
      {scene.key && active.scene !== "hold" ? (
        <MapKey kind={scene.key} k={k} borderMode={borderMode} hubs={state.hubs} after={state.after} extruded={scene.surface === "extruded"} />
      ) : null}
      <Chapters
        meta={meta}
        summary={summary}
        iso={iso}
        scene={scene}
        state={state}
        setState={(p) => setState((s) => ({ ...s, ...p }))}
        cb={cb}
        times={times}
        jbPop={jbPop}
        sites={sites}
      />
    </div>
  );
}

const WOODLANDS_NORTH = { lon: 103.7857, lat: 1.4482 };

/** A point inside a (multi)polygon for a label: centre of the largest ring's bounding box. */
function labelPoint(f: GeoJSON.Feature): [number, number] {
  const g = f.geometry;
  const rings: number[][][] = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
  let best: number[][] = rings[0] ?? [[0, 0]];
  let bestA = -1;
  for (const r of rings) {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    if (Math.abs(a) > bestA) {
      bestA = Math.abs(a);
      best = r;
    }
  }
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of best) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

export type { Aggregate };
