import type { Layer } from "@deck.gl/core";
import { Marker } from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Mode } from "../lib/crossborder";
import { hasWebGL } from "../lib/webgl";
import { MapCanvas, WebGLNotice, type MapHandle } from "../map/MapCanvas";
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
export function StoryMap({
  scene,
  layers,
  labels,
  mobile,
  fallback,
}: {
  scene: Scene;
  layers: Layer[];
  labels: MapLabel[];
  mobile: boolean;
  /** shown instead of the map when WebGL is off or the map fails to start */
  fallback: ReactNode;
}) {
  const ref = useRef<MapHandle>(null);
  const markers = useRef<Marker[]>([]);
  const [initial] = useState(() => scene.camera(mobile));
  const [down, setDown] = useState(() => !hasWebGL());

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

  if (down) return <>{fallback}</>;
  return (
    <div className="story-map" aria-hidden="true">
      <MapCanvas ref={ref} initialView={initial} layers={layers} interactive={false} showControls={false} onFail={() => setDown(true)} />
    </div>
  );
}

interface Still {
  src: string;
  alt: string;
  caption: string;
  /** which part of the picture to keep when cropped to a phone's shape */
  position: string;
}

const still = (file: string, alt: string, caption: string, position: string): Still => ({
  src: `${import.meta.env.BASE_URL}img/${file}`,
  alt,
  caption,
  position,
});

const HERO = still(
  "story-hero.jpg",
  "Singapore and Johor Bahru as hexagon columns: height shows residents, colour shows how many of six essentials are within a 15-minute walk",
  "Still image: both cities as hexagon columns",
  "70% 50%",
);
const WALK_JB = still(
  "walk-jb.jpg",
  "A walk-shed from Taman Johor Jaya on the street network inside its 1.08 km circle",
  "Still image: a 15-minute walk from Taman Johor Jaya",
  "70% 50%",
);
const BORDER_AV = still(
  "border-av.jpg",
  "Minutes from Johor Bahru homes to the first Singapore MRT platform with the RTS Link and an autonomous feeder",
  "Still image: minutes to the Singapore MRT with a shared autonomous feeder",
  "60% 50%",
);
const PARKING_SG = still(
  "parking-sg.jpg",
  "Cells newly reaching all six essentials when 25 car parks become neighbourhood hubs in Singapore",
  "Still image: 25 car parks converted to neighbourhood hubs",
  "60% 50%",
);

/**
 * The still that depicts a scene as it is now. Some scenes have controls (the
 * border lab, the hub count), so a still is only used while it matches them;
 * otherwise the scene has no still and shows a plain dark background.
 */
function stillFor(scene: Scene, border: Mode | null, hubs: number, after: boolean): Still | null {
  switch (scene.id) {
    case "hero":
    case "surface-both":
    case "surface-sg":
    case "surface-jb":
    case "gaps":
    case "end":
      return HERO;
    case "walk-jb":
      return WALK_JB;
    case "border-av":
      return BORDER_AV;
    case "border-lab":
      return border === "rts_av" ? BORDER_AV : null;
    case "parking-sg":
      return hubs === 25 && after ? PARKING_SG : null;
    default:
      return null;
  }
}

/** The scene as a still image: stands in for the live map when WebGL is off or the map failed. */
export function StoryStill({ scene, border, hubs, after }: { scene: Scene; border: Mode | null; hubs: number; after: boolean }) {
  const img = stillFor(scene, border, hubs, after);
  return (
    <>
      <div className="story-map story-still">
        {img ? (
          <figure className="still-figure">
            <img className="still-img" src={img.src} alt={img.alt} style={{ objectPosition: img.position }} decoding="async" />
            <div className="still-shade" aria-hidden="true" />
            <figcaption className="still-caption">{img.caption}</figcaption>
          </figure>
        ) : null}
      </div>
      <WebGLNotice fixed />
    </>
  );
}
