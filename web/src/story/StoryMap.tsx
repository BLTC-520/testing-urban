import type { Layer } from "@deck.gl/core";
import { Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { MapCanvas, type MapHandle } from "../map/MapCanvas";
import type { Scene } from "./scenes";

export interface MapLabel {
  lon: number;
  lat: number;
  title: string;
  sub?: string;
  lines?: string[];
  side?: "left" | "right";
}

/** Keep the subject clear of the text: cards sit left on desktop, at the bottom on phones. */
function cameraPadding(scene: Scene, mobile: boolean) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (mobile) return { top: 70, bottom: Math.round(h * 0.38), left: 10, right: 10 };
  if (scene.id === "hero" || scene.id === "end") return { top: 60, bottom: 40, left: Math.round(w * 0.4), right: 20 };
  return { top: 60, bottom: 40, left: Math.min(600, Math.round(w * 0.42)), right: 40 };
}

/** The story's single, fixed, non-interactive map: flies to each scene's camera. */
export function StoryMap({ scene, layers, labels, mobile }: { scene: Scene; layers: Layer[]; labels: MapLabel[]; mobile: boolean }) {
  const ref = useRef<MapHandle>(null);
  const markers = useRef<Marker[]>([]);
  const initial = useRef(scene.camera(mobile));

  const first = useRef(true);
  useEffect(() => {
    if (scene.id === "hold") return;
    const cam = scene.camera(mobile);
    // jump into the first scene; fly between the others
    ref.current?.flyTo({ ...cam, padding: cameraPadding(scene, mobile), duration: first.current ? 0 : (scene.duration ?? 2400) });
    first.current = false;
  }, [scene, mobile]);

  // slow orbit on the overview scenes (paused for reduced motion)
  useEffect(() => {
    if (!scene.rotate) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const m = ref.current?.map();
      const dt = Math.min(64, t - last);
      last = t;
      if (m && !m.isMoving() && document.visibilityState === "visible") m.setBearing(m.getBearing() + dt * 0.0016);
      raf = requestAnimationFrame(tick);
    };
    const start = window.setTimeout(() => (raf = requestAnimationFrame(tick)), (scene.duration ?? 2400) + 100);
    return () => {
      window.clearTimeout(start);
      cancelAnimationFrame(raf);
    };
  }, [scene]);

  useEffect(() => {
    const m = ref.current?.map();
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    if (!m) return;
    for (const l of labels) {
      const el = document.createElement("div");
      el.className = `map-label ${l.side ?? "right"}`;
      const b = document.createElement("b");
      b.textContent = l.title;
      el.appendChild(b);
      for (const line of [l.sub, ...(l.lines ?? [])]) {
        if (!line) continue;
        const s = document.createElement("span");
        s.textContent = line;
        el.appendChild(s);
      }
      markers.current.push(new Marker({ element: el, anchor: l.side === "left" ? "right" : "left", offset: [l.side === "left" ? -10 : 10, 0] }).setLngLat([l.lon, l.lat]).addTo(m));
    }
  }, [labels]);

  return (
    <div className="story-map" aria-hidden="true">
      <MapCanvas ref={ref} initialView={initial.current} layers={layers} interactive={false} showControls={false} />
    </div>
  );
}
