import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { addProtocol, Map as MLMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 locates its worker relative to its own module URL, which bundlers
// rewrite; pointing it at the emitted asset works in dev and production builds.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Protocol } from "pmtiles";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { basemapStyle } from "./basemapStyle";

let protocolRegistered = false;
function ensureProtocol() {
  if (protocolRegistered) return;
  setWorkerUrl(workerUrl);
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
  flyTo: (v: ViewState & { duration?: number }) => void;
  fitBounds: (b: [[number, number], [number, number]], padding?: number, duration?: number) => void;
}

interface Props {
  initialView: ViewState;
  layers: Layer[];
  interactive?: boolean;
  onClick?: (info: PickingInfo, lngLat: [number, number]) => void;
  onHover?: (info: PickingInfo) => void;
  getCursor?: (s: { isDragging: boolean; isHovering: boolean }) => string;
  className?: string;
  showControls?: boolean;
  onLoad?: () => void;
}

/** MapLibre basemap with a deck.gl overlay interleaved into its WebGL context. */
export const MapCanvas = forwardRef<MapHandle, Props>(function MapCanvas(
  { initialView, layers, interactive = true, onClick, onHover, getCursor, className, showControls = true, onLoad },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const handlers = useRef({ onClick, onHover, onLoad });
  handlers.current = { onClick, onHover, onLoad };

  useEffect(() => {
    ensureProtocol();
    if (!el.current) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const map = new MLMap({
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
    if (showControls && interactive) map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      onClick: (info) => {
        const ll = info.coordinate as [number, number] | undefined;
        if (ll) handlers.current.onClick?.(info, ll);
      },
      onHover: (info) => handlers.current.onHover?.(info),
      getCursor: getCursor ?? (({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "crosshair")),
    });
    map.addControl(overlay);
    map.on("load", () => handlers.current.onLoad?.());
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

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

  return <div ref={el} className={className} style={{ position: "absolute", inset: 0 }} />;
});
