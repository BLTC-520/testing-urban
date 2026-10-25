import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Effect, Layer, PickingInfo } from "@deck.gl/core";
// MapLibre 5.x: deck.gl 9.4's interleaved overlay reads map.transform, which
// MapLibre 6 no longer exposes.
import { addProtocol, Map as MLMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { hasWebGL } from "../lib/webgl";
import { basemapStyle } from "./basemapStyle";
import "./fallback.css";

let protocolRegistered = false;
function ensureProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

export interface ViewState {
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
}

export interface MapHandle {
  map: () => MLMap | null;
  flyTo: (v: ViewState & { duration?: number; padding?: { top: number; bottom: number; left: number; right: number } }) => void;
  fitBounds: (b: [[number, number], [number, number]], padding?: number, duration?: number) => void;
}

interface Props {
  initialView: ViewState;
  layers: Layer[];
  /**
   * deck.gl effects, which in practice means a lighting rig. Only 3D layers
   * read it, so a map of flat fills can pass one and see no difference.
   */
  effects?: Effect[];
  interactive?: boolean;
  onClick?: (info: PickingInfo, lngLat: [number, number]) => void;
  onHover?: (info: PickingInfo) => void;
  getCursor?: (s: { isDragging: boolean; isHovering: boolean }) => string;
  className?: string;
  showControls?: boolean;
  onLoad?: () => void;
  /** called once when the map cannot be shown: no WebGL, a failed start or a lost context */
  onFail?: (reason: string) => void;
  /**
   * Collapse the attribution to its (i) button this long after the map loads. MapLibre
   * collapses it on the first drag; a map nobody drags (the Story's) would otherwise
   * keep it open over the text that scrolls past.
   */
  collapseAttributionMs?: number;
}

/** Basemap label layers; area fills from deck.gl are drawn beneath them so names stay readable. */
const LABEL_LAYER = "places";
const UNDER_LABELS = new Set(["H3HexagonLayer", "GeoJsonLayer", "PolygonLayer", "SolidPolygonLayer"]);

function underLabels(l: Layer): Layer {
  const name = (l.constructor as { layerName?: string }).layerName ?? "";
  // beforeId is read by the interleaved MapboxOverlay; it is not part of the base layer props type
  const placed = (l.props as { beforeId?: string }).beforeId !== undefined;
  return UNDER_LABELS.has(name) && !placed ? l.clone({ beforeId: LABEL_LAYER } as never) : l;
}

/**
 * MapLibre basemap with a deck.gl overlay interleaved into its WebGL context.
 * When the map cannot start, it renders nothing and reports why through onFail.
 */
export const MapCanvas = forwardRef<MapHandle, Props>(function MapCanvas(
  { initialView, layers, effects, interactive = true, onClick, onHover, getCursor, className, showControls = true, onLoad, onFail, collapseAttributionMs },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [failed, setFailed] = useState(false);
  const handlers = useRef({ onClick, onHover, onLoad, onFail });
  handlers.current = { onClick, onHover, onLoad, onFail };

  useEffect(() => {
    if (!el.current) return;
    const fail = (reason: string) => {
      console.warn(`Map not shown: ${reason}`);
      setFailed(true);
      handlers.current.onFail?.(reason);
    };
    if (!hasWebGL()) {
      fail("WebGL is not available");
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let map: MLMap | null = null;
    try {
      ensureProtocol();
      map = new MLMap({
        container: el.current,
        style: basemapStyle(),
        center: initialView.center,
        zoom: initialView.zoom,
        pitch: initialView.pitch ?? 0,
        bearing: initialView.bearing ?? 0,
        interactive,
        attributionControl: { compact: true },
        maxBounds: [
          [102.9, 0.9],
          [104.7, 2.05],
        ],
        minZoom: 8,
        maxZoom: 17.5,
        fadeDuration: reduced ? 0 : 300,
      });
      // The compass carries the pitch indicator, and the pitch is what makes
      // the 3D landmarks worth drawing: from straight down they are blobs.
      // Clicking it puts the map back to north-up and flat.
      if (showControls && interactive) {
        map.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
      }
      const overlay = new MapboxOverlay({
        interleaved: true,
        layers: [],
        onHover: (info) => handlers.current.onHover?.(info),
        onError: (e) => console.error("deck.gl:", e),
        getCursor: getCursor ?? (({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "crosshair")),
      });
      map.addControl(overlay);
      // Clicks come from MapLibre (robust to slow GPU picking and touch); deck.gl only picks.
      map.on("click", (e) => {
        const info = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 3 }) ?? ({ picked: false } as PickingInfo);
        const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        (window as unknown as { __lastClick?: unknown }).__lastClick = { picked: info.picked, layer: info.layer?.id, ll };
        handlers.current.onClick?.(info, ll);
      });
      map.on("load", () => handlers.current.onLoad?.());
      if (collapseAttributionMs !== undefined) {
        const box = map.getContainer();
        map.once("load", () =>
          window.setTimeout(() => box.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove("maplibregl-compact-show"), collapseAttributionMs),
        );
      }
      // a lost context cannot be recovered in place, so the map counts as failed
      map.on("webglcontextlost", () => fail("the WebGL context was lost"));
      mapRef.current = map;
      overlayRef.current = overlay;
      // exposed for end-to-end tests and debugging
      (window as unknown as { __map?: MLMap; __overlay?: MapboxOverlay }).__map = map;
      (window as unknown as { __overlay?: MapboxOverlay }).__overlay = overlay;
    } catch (e) {
      map?.remove();
      fail(e instanceof Error ? e.message : String(e));
      return;
    }
    return () => {
      map?.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    overlayRef.current?.setProps({ layers: layers.map(underLabels) });
  }, [layers]);

  // Separate from the layers effect: the rig is built once and the layers
  // change on every filter, so pushing both together would reupload it.
  useEffect(() => {
    if (effects) overlayRef.current?.setProps({ effects });
  }, [effects]);

  useImperativeHandle(ref, () => ({
    map: () => mapRef.current,
    flyTo: ({ duration = 2400, ...v }) => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      mapRef.current?.flyTo({ ...v, duration: reduced ? 0 : duration, essential: false, curve: 1.3 });
    },
    fitBounds: (b, padding = 40, duration = 1600) => {
      mapRef.current?.fitBounds(b, { padding, duration });
    },
  }));

  if (failed) return null;
  return <div ref={el} className={className} style={{ position: "absolute", inset: 0 }} />;
});

/** Stands in for an interactive map when WebGL is off or the map failed. */
export function WebGLNotice({ fixed = false, detail }: { fixed?: boolean; detail?: string }) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div className={fixed ? "webgl-notice fixed" : "webgl-notice"} role="note">
      <p>Interactive maps need WebGL, which is turned off in this browser. The text, charts and data below are unaffected.</p>
      {detail ? <p className="notice-detail">{detail}</p> : null}
      {fixed ? (
        <button type="button" className="notice-close" aria-label="Dismiss this notice" onClick={() => setClosed(true)}>
          ×
        </button>
      ) : null}
    </div>
  );
}
