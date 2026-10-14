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
      <MapCanvas ref={ref} initialView={initial} layers={layers} interactive={false} showControls={false} onFail={() => setDown(true)} collapseAttributionMs={6000} />
    </div>
  );
}

interface Still {
  src: string;
  alt: string;
  caption: string;
}

/**
 * One still per scene, rendered from the live map by scripts/stills.mjs (map only:
 * no text, header or legend), so a browser without WebGL sees what the scene shows.
 */
const STILLS: Record<string, [alt: string, caption: string]> = {
  hero: ["Singapore and Johor Bahru as hexagon columns: height shows residents, colour shows how many of six essentials are within a 15-minute walk", "both cities as hexagon columns"],
  "walk-sg": ["A 15-minute walk from the centre of Toa Payoh on the street network, inside its 1.08 km circle", "a 15-minute walk from Toa Payoh"],
  "walk-jb": ["A 15-minute walk from Taman Johor Jaya on the street network, inside its 1.08 km circle", "a 15-minute walk from Taman Johor Jaya"],
  "surface-sg": ["Singapore's hexagons coloured by how many of six essentials are within a 15-minute walk", "Singapore, essentials within 15 minutes"],
  "surface-jb": ["Johor Bahru's hexagons coloured by how many of six essentials are within a 15-minute walk", "Johor Bahru, essentials within 15 minutes"],
  gaps: ["The populous neighbourhoods with the lowest share of residents reaching all six essentials, outlined", "the neighbourhoods with the largest gaps"],
  "border-hubs": ["Johor Bahru's border hubs and the RTS Link's Woodlands North terminus", "the border hubs"],
  "border-baseline": ["Minutes from Johor Bahru homes to the first Singapore MRT platform by bus or KTM shuttle today, central border assumptions", "minutes to the Singapore MRT today"],
  "border-rts": ["Minutes from Johor Bahru homes to the first Singapore MRT platform with the RTS Link, central border assumptions", "minutes to the Singapore MRT with the RTS Link"],
  "border-av": ["Minutes from Johor Bahru homes to the first Singapore MRT platform with the RTS Link and a shared autonomous feeder, central border assumptions", "minutes to the Singapore MRT with an autonomous feeder"],
  "parking-jb": ["Johor Bahru cells newly reaching all six essentials when 25 car parks become neighbourhood hubs", "25 car parks converted to hubs in Johor Bahru"],
  "parking-sg": ["Singapore cells newly reaching all six essentials when 25 car parks become neighbourhood hubs", "25 car parks converted to hubs in Singapore"],
  end: ["Both cities coloured by how many of six essentials are within a 15-minute walk", "both cities, essentials within 15 minutes"],
};

const BORDER_STILL: Record<Mode, string> = { baseline: "border-baseline", rts: "border-rts", rts_av: "border-av" };

/**
 * The still that depicts a scene as it is now. The border lab shows the still of
 * the selected mode (at central border assumptions, as captioned); the hub
 * scenes only while the hub controls are at the pictured 25 hubs, "after".
 */
function stillFor(scene: Scene, border: Mode | null, hubs: number, after: boolean): Still | null {
  let id = scene.id;
  if (id === "surface-both") id = "end";
  if (id === "border-lab") id = border ? BORDER_STILL[border] : "";
  if ((id === "parking-sg" || id === "parking-jb") && !(hubs === 25 && after)) return null;
  const s = STILLS[id];
  return s ? { src: `${import.meta.env.BASE_URL}img/story/${id}.jpg`, alt: s[0], caption: s[1] } : null;
}

/** The scene as a still image: stands in for the live map when WebGL is off or the map failed. */
export function StoryStill({ scene, border, hubs, after }: { scene: Scene; border: Mode | null; hubs: number; after: boolean }) {
  const img = stillFor(scene, border, hubs, after);
  return (
    <>
      <div className="story-map story-still">
        {img ? (
          <figure className="still-figure">
            <img className="still-img" src={img.src} alt={img.alt} decoding="async" />
            <div className="still-shade" aria-hidden="true" />
          </figure>
        ) : null}
      </div>
      <WebGLNotice fixed detail={img ? `Behind the text: a still image of ${img.caption}. Map data © OpenStreetMap contributors.` : undefined} />
    </>
  );
}
