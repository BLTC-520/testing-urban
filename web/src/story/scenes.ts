/**
 * Map scenes for the story. A scene is a camera plus a declaration of which
 * analysis layers are visible; Story.tsx turns it into deck.gl layers.
 */
import type { CityId } from "../lib/types";

export interface Camera {
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
}

export interface Scene {
  id: string;
  camera: (mobile: boolean) => Camera;
  /** completeness surface: flat, extruded by residents, or none */
  surface?: "flat" | "extruded" | null;
  /** fade one city's surface to put the other in focus */
  focus?: CityId | null;
  /** live walk-shed from a fixed point, with the 15-minute "as the crow flies" circle */
  walk?: { lon: number; lat: number; city: CityId; label: string } | null;
  units?: "outline" | "highlight" | null;
  border?: "baseline" | "rts" | "rts_av" | "lab" | null;
  parking?: CityId | null;
  rotate?: boolean;
  duration?: number;
  /** map key to show in the corner */
  key?: "essentials" | "walk" | "border" | "parking" | null;
}

/**
 * Demonstration points: the OpenStreetMap place nodes of two comparable
 * neighbourhoods (place=suburb), so the examples are not hand-picked spots.
 */
export const WALK_POINTS = {
  sg: { lon: 103.8481, lat: 1.3356, city: "sg" as CityId, label: "Toa Payoh, Singapore" },
  jb: { lon: 103.8024, lat: 1.5428, city: "jb" as CityId, label: "Taman Johor Jaya, Johor Bahru" },
};

const both = (m: boolean): Camera => ({ center: [103.79, 1.43], zoom: m ? 9.05 : 10.0, pitch: 0, bearing: 0 });

export const SCENES: Record<string, Scene> = {
  hero: {
    id: "hero",
    camera: (m) => ({ center: [103.78, 1.44], zoom: m ? 8.7 : 9.7, pitch: 52, bearing: -14 }),
    surface: "extruded",
    rotate: true,
    key: "essentials",
  },
  "walk-sg": {
    id: "walk-sg",
    camera: (m) => ({ center: [WALK_POINTS.sg.lon, WALK_POINTS.sg.lat - (m ? 0.004 : 0)], zoom: m ? 13.4 : 14.3, pitch: 0, bearing: 0 }),
    surface: null,
    walk: WALK_POINTS.sg,
    key: "walk",
    duration: 3200,
  },
  "walk-jb": {
    id: "walk-jb",
    camera: (m) => ({ center: [WALK_POINTS.jb.lon, WALK_POINTS.jb.lat - (m ? 0.004 : 0)], zoom: m ? 13.4 : 14.3, pitch: 0, bearing: 0 }),
    surface: null,
    walk: WALK_POINTS.jb,
    key: "walk",
    duration: 3200,
  },
  "surface-sg": {
    id: "surface-sg",
    camera: (m) => ({ center: [103.83, 1.36], zoom: m ? 9.9 : 10.9, pitch: 0, bearing: 0 }),
    surface: "flat",
    focus: "sg",
    units: "outline",
    key: "essentials",
  },
  "surface-jb": {
    id: "surface-jb",
    camera: (m) => ({ center: [103.74, 1.53], zoom: m ? 9.5 : 10.45, pitch: 0, bearing: 0 }),
    surface: "flat",
    focus: "jb",
    units: "outline",
    key: "essentials",
  },
  "surface-both": {
    id: "surface-both",
    camera: both,
    surface: "flat",
    units: "outline",
    key: "essentials",
  },
  gaps: {
    id: "gaps",
    camera: both,
    surface: "flat",
    units: "highlight",
    key: "essentials",
  },
  "border-hubs": {
    id: "border-hubs",
    camera: (m) => ({ center: [103.775, 1.456], zoom: m ? 12.0 : 12.9, pitch: 0, bearing: 0 }),
    surface: null,
    border: null,
    key: null,
    duration: 3000,
  },
  "border-baseline": {
    id: "border-baseline",
    camera: (m) => ({ center: [103.74, 1.52], zoom: m ? 9.6 : 10.5, pitch: 0, bearing: 0 }),
    border: "baseline",
    key: "border",
  },
  "border-rts": {
    id: "border-rts",
    camera: (m) => ({ center: [103.74, 1.52], zoom: m ? 9.6 : 10.5, pitch: 0, bearing: 0 }),
    border: "rts",
    key: "border",
  },
  "border-av": {
    id: "border-av",
    camera: (m) => ({ center: [103.74, 1.52], zoom: m ? 9.6 : 10.5, pitch: 0, bearing: 0 }),
    border: "rts_av",
    key: "border",
  },
  "border-lab": {
    id: "border-lab",
    camera: (m) => ({ center: [103.74, 1.52], zoom: m ? 9.6 : 10.5, pitch: 0, bearing: 0 }),
    border: "lab",
    key: "border",
  },
  "parking-jb": {
    id: "parking-jb",
    camera: (m) => ({ center: [103.75, 1.52], zoom: m ? 9.7 : 10.6, pitch: 0, bearing: 0 }),
    parking: "jb",
    key: "parking",
  },
  "parking-sg": {
    id: "parking-sg",
    camera: (m) => ({ center: [103.83, 1.36], zoom: m ? 9.9 : 10.9, pitch: 0, bearing: 0 }),
    parking: "sg",
    key: "parking",
  },
  end: {
    id: "end",
    camera: (m) => ({ center: [103.78, 1.44], zoom: m ? 8.7 : 9.7, pitch: 50, bearing: 12 }),
    surface: "extruded",
    rotate: true,
    key: "essentials",
  },
  /** essays cover the map; keep whatever was there */
  hold: { id: "hold", camera: both },
};
