import type { PickingInfo } from "@deck.gl/core";
import { cellToParent, latLngToCell } from "h3-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Header } from "../components/Header";
import { loadMeta, loadNeighbourhoods, loadPois, loadSummary, peekMeta, peekNeighbourhoods, peekSummary, type Pois } from "../lib/data";
import { layoutFromParams, paramsFromView, viewFromParams, withLayout, type ExplorerLayout } from "../lib/explorerUrl";
import { bbox } from "../lib/geo";
import { replaceParams } from "../lib/router";
import { useExplorer } from "../lib/store";
import type { CityId, Meta, Summary } from "../lib/types";
import { hasWebGL } from "../lib/webgl";
import { landmarkLayers, nightLighting } from "../map/landmarks";
import { hexLayer, isochroneLayer, markerLayer, poiLayer, unitsLayer } from "../map/layers";
import { MapCanvas, WebGLNotice, type MapHandle } from "../map/MapCanvas";
import { ControlPanel } from "./ControlPanel";
import "./explorer.css";
import { Inspector } from "./Inspector";
import { Legend } from "./Legend";
import { NeighbourhoodTable } from "./NeighbourhoodTable";
import { useIsochrone } from "./useIsochrone";
import { resolutionForZoom, useHexData, useSurfaces, type SurfaceParams } from "./useSurface";

export function Explorer({ params }: { params: URLSearchParams }) {
  const s = useExplorer();
  const [meta, setMeta] = useState<Meta | null>(peekMeta);
  const [summary, setSummary] = useState<Summary | null>(peekSummary);
  const [units, setUnits] = useState<GeoJSON.FeatureCollection | null>(peekNeighbourhoods);
  const [pois, setPois] = useState<Partial<Record<CityId, Pois>>>({});
  const [hover, setHover] = useState<{ x: number; y: number; unit?: GeoJSON.Feature; poi?: number; city?: CityId } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const mapRef = useRef<MapHandle>(null);
  // the map or the table; view=table in the URL asks for the table
  const [layout, setLayout] = useState<ExplorerLayout>(() => layoutFromParams(params));
  // without WebGL, or once the map has failed, the table is the only view
  const [mapDown, setMapDown] = useState<string | null>(() => (hasWebGL() ? null : "WebGL is turned off in this browser"));
  const view: ExplorerLayout = mapDown ? "table" : layout;

  useEffect(() => {
    loadMeta().then(setMeta);
    loadSummary().then(setSummary);
    loadNeighbourhoods().then(setUnits);
  }, []);

  // the URL is the source of truth on arrival (and on back/forward or agent navigation) …
  // (a bare /explore/ keeps whatever was set earlier in this visit)
  const [unitFocus, setUnitFocus] = useState<string | null>(() => params.get("unit"));
  const [mapReady, setMapReady] = useState(false);
  const arrived = useRef(false);
  const paramKey = params.toString();
  // the query string for everything on this page: the analysis, the neighbourhood in focus, the layout
  const urlParams = () => {
    const p = paramsFromView(useExplorer.getState());
    if (unitFocus && !useExplorer.getState().selection) p.set("unit", unitFocus);
    return withLayout(p, layout);
  };
  useEffect(() => {
    const current = urlParams();
    if (paramKey !== current.toString() && (paramKey || arrived.current)) {
      s.set(viewFromParams(params));
      setUnitFocus(params.get("unit"));
      setLayout(layoutFromParams(params));
    }
    arrived.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);
  // … and afterwards every change is written back to it, so any view can be shared
  useEffect(() => {
    replaceParams(urlParams());
  }, [s.metric, s.threshold, s.speed, s.people, s.taxonomy, s.network, s.poiSource, s.scenario, s.selection, unitFocus, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?unit=BD: frame that neighbourhood once its outline is known (while the map is on screen)
  useEffect(() => {
    if (!unitFocus || !units || view !== "map") return;
    const f = units.features.find((x) => x.properties?.unit_id === unitFocus);
    if (f) mapRef.current?.fitBounds(bbox(f), 40, 0);
  }, [unitFocus, units, mapReady, view]);

  useEffect(() => {
    if (s.showPois && s.zoom >= 12.5) {
      (["sg", "jb"] as CityId[]).forEach((c) => {
        if (!pois[c]) loadPois(c).then((p) => setPois((prev) => ({ ...prev, [c]: p })));
      });
    }
  }, [s.showPois, s.zoom, pois]);

  const unitIds = useMemo(() => {
    const ids: string[] = [];
    units?.features.forEach((f) => (ids[Number(f.properties?.idx)] = String(f.properties?.unit_id)));
    return ids;
  }, [units]);

  const sp: SurfaceParams = useMemo(
    () => ({ metric: s.metric, threshold: s.threshold, speed: s.speed, people: s.people, taxonomy: s.taxonomy, network: s.network, poiSource: s.poiSource, scenario: s.scenario }),
    [s.metric, s.threshold, s.speed, s.people, s.taxonomy, s.network, s.poiSource, s.scenario],
  );
  const surfaces = useSurfaces(meta, sp);
  const res = resolutionForZoom(s.zoom);
  const hexData = useHexData(surfaces, res);
  const speed = meta ? meta.accessibility.walk_speed_mps[s.speed] : 1.2;
  const iso = useIsochrone(s.selection, speed, s.threshold);
  const k = meta?.basket.length ?? 6;
  const kind = s.metric === "complete" ? "count" : "minutes";

  const highlight = useMemo(() => (iso.reached ? new Set(iso.reached.pois.filter((p) => p.minutes <= s.threshold).map((p) => p.i)) : undefined), [iso.reached, s.threshold]);
  const poiCats = useMemo(() => (s.metric === "complete" ? meta?.basket ?? [] : [s.metric]), [s.metric, meta]);

  const layers = useMemo(() => {
    const L = [];
    L.push(hexLayer("cells", hexData, kind, k, { coverage: res >= 10 ? 0.94 : 1, opacity: iso.iso ? 0.28 : 0.82, trigger: `${res}|${kind}` }));
    if (units && s.showUnits) L.push(unitsLayer("units", units, (hover?.unit?.properties?.unit_id as string) ?? null));
    if (iso.iso) L.push(isochroneLayer("iso", iso.iso.segments, iso.reveal, speed));
    if (s.showPois && s.zoom >= 12.5) {
      for (const c of ["sg", "jb"] as CityId[]) {
        const p = pois[c];
        if (p) L.push(poiLayer(`pois-${c}`, p, { categories: poiCats, highlight }));
      }
    }
    if (s.selection) L.push(markerLayer("marker", [s.selection.lon, s.selection.lat]));
    // Last, so they draw over the surface rather than through it.
    L.push(...landmarkLayers({ zoom: s.zoom, visible: s.showLandmarks }));
    return L;
  }, [hexData, kind, k, res, units, s.showUnits, iso.iso, iso.reveal, speed, s.showPois, s.showLandmarks, s.zoom, pois, poiCats, highlight, s.selection, hover?.unit]);

  // Built once: the only 3D layers on this map are the landmarks.
  const effects = useMemo(() => [nightLighting()], []);

  // which city a point belongs to: membership of its H3 r8 parent in each city's cells
  const cityParents = useMemo(() => {
    const out: Partial<Record<CityId, Set<string>>> = {};
    for (const [c, sfc] of Object.entries(surfaces)) {
      if (!sfc) continue;
      const set = new Set<string>();
      for (const h of sfc.cells.h3) set.add(cellToParent(h, 8));
      out[c as CityId] = set;
    }
    return out;
  }, [surfaces.sg?.cells, surfaces.jb?.cells]); // eslint-disable-line react-hooks/exhaustive-deps

  // a point from the URL may come without its city: infer it once the cells are loaded
  useEffect(() => {
    const sel = s.selection;
    if (!sel || sel.city || !cityParents.sg || !cityParents.jb) return;
    const p = latLngToCell(sel.lat, sel.lon, 8);
    const city = cityParents.sg.has(p) ? "sg" : cityParents.jb.has(p) ? "jb" : null;
    if (city) s.set({ selection: { ...sel, city } });
  }, [s.selection, cityParents]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = (info: PickingInfo, ll: [number, number]) => {
    const unit = info.layer?.id === "units" ? (info.object as GeoJSON.Feature) : undefined;
    let city = (unit?.properties?.city as CityId | undefined) ?? null;
    if (!city) {
      const p = latLngToCell(ll[1], ll[0], 8);
      city = cityParents.sg?.has(p) ? "sg" : cityParents.jb?.has(p) ? "jb" : null;
    }
    setUnitFocus(null);
    s.set({ selection: { lon: ll[0], lat: ll[1], city } });
  };

  const onHover = (info: PickingInfo) => {
    if (!info.picked) return setHover(null);
    if (info.layer?.id === "units") setHover({ x: info.x, y: info.y, unit: info.object as GeoJSON.Feature });
    else if (info.layer?.id.startsWith("pois-")) setHover({ x: info.x, y: info.y, poi: info.object as number, city: info.layer.id.slice(5) as CityId });
  };

  const initial = useMemo(() => {
    const sel = useExplorer.getState().selection;
    if (sel) return { center: [sel.lon, sel.lat] as [number, number], zoom: 13.6 };
    return { center: [103.76, 1.43] as [number, number], zoom: window.innerWidth < 700 ? 9.4 : 10.2 };
  }, []);

  return (
    <div className="explorer">
      <Header path="/explore" />
      {/* the map stays mounted while the table is shown, so returning to it keeps its view */}
      <div className="explorer-map" hidden={view !== "map"}>
        <ErrorBoundary fallback={() => null} onError={(e) => setMapDown(e.message || "the map failed")}>
          <MapCanvas
            ref={mapRef}
            initialView={initial}
            layers={layers}
            effects={effects}
            onClick={onClick}
            onHover={onHover}
            onFail={(reason) => setMapDown(reason)}
            onLoad={() => {
              setMapReady(true);
              const m = mapRef.current?.map();
              if (m) {
                s.set({ zoom: m.getZoom() });
                m.on("zoomend", () => s.set({ zoom: m.getZoom() }));
              }
            }}
          />
        </ErrorBoundary>
        {view === "map" && hover && (hover.poi !== undefined || (hover.unit && !s.selection)) ? (
          <HoverCard hover={hover} pois={pois} summary={summary} />
        ) : null}
      </div>
      <div className="explorer-tools" data-panel={panelOpen ? "open" : "closed"} data-view={view}>
        <button className="panel-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen} aria-controls="explorer-panel">
          {panelOpen ? "Hide controls" : "Controls"}
        </button>
        <div className="segmented sm view-toggle" role="radiogroup" aria-label="View">
          <button
            type="button"
            role="radio"
            aria-checked={view === "map"}
            className={view === "map" ? "on" : ""}
            disabled={!!mapDown}
            title={mapDown ? "The map needs WebGL" : undefined}
            onClick={() => setLayout("map")}
          >
            Map
          </button>
          <button type="button" role="radio" aria-checked={view === "table"} className={view === "table" ? "on" : ""} onClick={() => setLayout("table")}>
            Table
          </button>
        </div>
      </div>
      {meta ? (
        <aside id="explorer-panel" className={`explorer-panel${panelOpen ? "" : " closed"}`} aria-label="Explorer controls">
          <ControlPanel
            meta={meta}
            summary={summary}
            surfaces={surfaces}
            onFly={(c, z, id) => {
              setUnitFocus(id ?? null);
              // a jump is a map action, so it brings the map back when there is one
              if (!mapDown) setLayout("map");
              mapRef.current?.flyTo({ center: c, zoom: z, duration: 1800 });
            }}
          />
        </aside>
      ) : null}
      {meta && view === "map" ? <Legend meta={meta} kind={kind} metric={s.metric} threshold={s.threshold} iso={!!iso.iso} speed={speed} /> : null}
      {view === "table" ? (
        <NeighbourhoodTable
          summary={summary}
          meta={meta}
          unitIds={unitIds}
          surfaces={surfaces}
          metric={s.metric}
          threshold={s.threshold}
          people={s.people}
          speed={speed}
          panelOpen={panelOpen}
          inspecting={!!s.selection}
          notice={mapDown ? <WebGLNotice /> : null}
        />
      ) : null}
      {s.selection ? (
        <Inspector
          meta={meta}
          summary={summary}
          iso={iso}
          threshold={s.threshold}
          speed={speed}
          onClose={() => s.set({ selection: null })}
          surfaces={surfaces}
          unitIds={unitIds}
        />
      ) : view === "map" ? (
        <div className="explorer-hint" aria-live="polite">
          <span className="pulse-dot" aria-hidden /> Click anywhere on land to walk the street network from that spot
        </div>
      ) : null}
    </div>
  );
}

function HoverCard({
  hover,
  pois,
  summary,
}: {
  hover: { x: number; y: number; unit?: GeoJSON.Feature; poi?: number; city?: CityId };
  pois: Partial<Record<CityId, Pois>>;
  summary: Summary | null;
}) {
  let body: React.ReactNode = null;
  if (hover.poi !== undefined && hover.city && pois[hover.city]) {
    const p = pois[hover.city]!;
    const name = p.names?.[hover.poi] || "(unnamed)";
    const kind = (p.kinds?.[hover.poi] || "").replace(/_/g, " ");
    body = (
      <>
        <b>{name}</b>
        <span className="muted">{kind}</span>
      </>
    );
  } else if (hover.unit) {
    const pr = hover.unit.properties as Record<string, unknown>;
    const nb = summary?.neighbourhoods.find((n) => n.unit_id === pr.unit_id);
    body = (
      <>
        <b>{String(pr.unit_name)}</b>
        <span className="muted">{pr.city === "sg" ? "Planning area, Singapore" : "State constituency, Johor Bahru"}</span>
        {nb ? (
          <span>
            <b className="num">{Math.round(nb.share_complete * 100)}%</b> of residents reach all six essentials in 15 min
          </span>
        ) : null}
      </>
    );
  }
  if (!body) return null;
  const left = Math.min(hover.x + 14, window.innerWidth - 260);
  return (
    <div className="hover-card" style={{ left, top: hover.y + 14 }}>
      {body}
    </div>
  );
}
