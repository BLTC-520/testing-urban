/**
 * The 3D landmarks: where they stand, how big they are drawn, and when.
 *
 * The models themselves are built by `scripts/landmarks/build_models.py`, which
 * runs Blender headless and writes one glTF binary per landmark into
 * `public/models/` plus the manifest imported below. Nothing in this file
 * models anything — it decides placement and visibility, which are map
 * questions rather than modelling ones.
 *
 * Why a landmark layer at all
 * ---------------------------
 * The hex layer answers the dashboard's question; the landmarks answer "where
 * am I?". A reader who knows Singapore finds the Sands and the Flyer before
 * they read a single hexagon, and the Causeway buildings are the two ends of
 * the only land crossing this whole study is about. That is worth about 400 kB
 * of geometry and no measurable frame time.
 *
 * Scale, honestly
 * ---------------
 * Every model is built at its real size in metres and drawn at its real size,
 * with one documented exception: anything shorter than MIN_DRAWN_M is scaled up
 * to that height, because the Merlion is 8.6 m tall and would otherwise be a
 * single pixel at any zoom this dashboard uses. The exaggeration is reported in
 * the hover card rather than hidden.
 */
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import manifest from "./landmarks.json";

export interface Landmark {
  id: string;
  name: string;
  city: string;
  lon: number;
  lat: number;
  /** Degrees clockwise from north: which way the model's long axis points. */
  bearing: number;
  height_m: number;
  /** The model's largest dimension, measured in Blender rather than declared. */
  extent_m: number;
  model: string;
  facts: string;
  /** How well sourced the dimensions are: published / derived / estimated. */
  confidence: string;
  position_from: string;
  bearing_from: string;
}

export const LANDMARKS: Landmark[] = manifest.landmarks;

/**
 * Below this zoom the layer is not drawn at all.
 *
 * At zoom 12 one pixel is about 38 m on the ground near the equator, so a 200 m
 * tower is five pixels tall and a cluster of eighteen landmarks is noise over the
 * data. They fade in over the next three-quarters of a zoom level rather than
 * appearing all at once, which on a wall display reads as the map gaining
 * detail instead of something switching on.
 */
export const MIN_ZOOM = 12.3;
const FADE_ZOOM = 0.75;

/**
 * Nothing is drawn smaller than this across its largest dimension.
 *
 * 80 m is about where a model stops being a smudge at the zoom the layer fades
 * in at. The measure is the model's *extent*, not its height: the Causeway is
 * 17 m tall and 1,056 m long, and a height-based rule decided it needed
 * enlarging three-fold, which would have put a 3.4 km embankment across a
 * 1 km strait.
 *
 * In practice only the Merlion is affected: 8.6 m of statue on an 11 m plinth
 * measures 18 m across, and everything else on the map is at least 100 m. The
 * hover card says so. A map symbol that is not to scale is
 * ordinary; one that does not admit it is not.
 */
const MIN_DRAWN_M = 80;

/** How much a landmark is enlarged to reach MIN_DRAWN_M. 1 means true scale. */
export const exaggeration = (l: Landmark): number =>
  Math.max(1, MIN_DRAWN_M / (l.extent_m || l.height_m));

export const opacityAt = (zoom: number): number =>
  Math.max(0, Math.min(1, (zoom - MIN_ZOOM) / FADE_ZOOM));

export interface LandmarkLayerOptions {
  zoom: number;
  visible: boolean;
  /** Dim the landmarks of the city that is not currently selected. */
  city: string;
  onHover?: (info: { x: number; y: number; object?: Landmark }) => void;
  onClick?: (l: Landmark) => void;
}

/**
 * One ScenegraphLayer per model file.
 *
 * deck.gl loads one scenegraph per layer, so eighteen models means eighteen
 * layers. That is cheaper than it sounds: each is a single instance of a few
 * hundred triangles, and deck.gl's layer overhead is far smaller than the draw
 * it replaces. The alternative — one layer with an instanced mesh — would need
 * all eighteen landmarks to share one geometry, which is the opposite of the
 * point.
 */
export function landmarkLayers(opts: LandmarkLayerOptions) {
  const opacity = opacityAt(opts.zoom);
  if (!opts.visible || opacity <= 0) return [];

  return LANDMARKS.map((l) =>
    new ScenegraphLayer<Landmark>({
      id: `landmark-${l.id}`,
      data: [l],
      scenegraph: `models/${l.model}`,
      getPosition: () => [l.lon, l.lat, 0],
      /*
       * deck.gl takes [pitch, yaw, roll] in degrees and composes them as
       * Rz(yaw)·Ry(pitch)·Rx(roll).
       *
       * The roll of 90 is the fixed correction from glTF's Y-up to deck.gl's
       * Z-up; every ScenegraphLayer needs it. After it, the model's +X — the
       * axis every builder lays its landmark along — points at deck's +X,
       * which is east, i.e. bearing 90. Rz then turns it anticlockwise, from
       * east towards north. So to land the model's axis on a compass bearing
       * the yaw is 90 minus that bearing, not its negation.
       *
       * Getting this wrong is quiet: every landmark is simply rotated by the
       * same wrong amount and still looks like a building. It was caught by
       * the check page with the camera facing north — see landmarksCheck.ts.
       */
      getOrientation: () => [0, 90 - l.bearing, 90],
      getScale: () => {
        const s = exaggeration(l);
        return [s, s, s];
      },
      sizeScale: 1,
      // The landmarks of the other city stay on the map — the Causeway pair
      // only makes sense as a pair — but they recede.
      opacity: opacity * (l.city === opts.city ? 1 : 0.45),
      _lighting: "pbr",
      pickable: true,
      onHover: (info) => opts.onHover?.({ x: info.x, y: info.y, object: info.object ?? undefined }),
      onClick: (info) => {
        if (info.object) opts.onClick?.(info.object);
      },
      // The accessors are constants per landmark, so these only ever fire when
      // the manifest itself changes — which is to say, on a hot reload after a
      // rebuild. They are here so that rebuild shows up without a page refresh.
      updateTriggers: {
        getScale: [l.height_m],
        getOrientation: [l.bearing],
      },
    }),
  );
}

/** Metres per pixel at a zoom and latitude. The Web Mercator ground resolution. */
export const metresPerPixel = (lat: number, zoom: number): number =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};

/**
 * The camera that brings a city's landmarks into view.
 *
 * Needed because the layer is invisible at the zoom the dashboard opens at,
 * which makes a feature nobody can find. Switching the landmarks on from the
 * overview now takes the camera to them.
 *
 * The centre is the *median* landmark, not the mean: Singapore's set is seven
 * buildings around Marina Bay and one checkpoint eighteen kilometres north at
 * Woodlands, and a mean lands the camera in the middle of the island looking
 * at nothing. The zoom then fits whatever sits within 3 km of that median,
 * which is the cluster rather than the outlier.
 */
export function landmarkView(
  city: string,
  viewportPx = 900,
): { center: [number, number]; zoom: number } | null {
  const marks = LANDMARKS.filter((l) => l.city === city);
  if (!marks.length) return null;

  const lon = median(marks.map((m) => m.lon));
  const lat = median(marks.map((m) => m.lat));
  const mPerLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const near = marks.filter(
    (m) => Math.hypot((m.lon - lon) * mPerLon, (m.lat - lat) * 110_540) < 3_000,
  );

  const spanM = Math.max(
    200,
    (Math.max(...near.map((m) => m.lon)) - Math.min(...near.map((m) => m.lon))) * mPerLon,
    (Math.max(...near.map((m) => m.lat)) - Math.min(...near.map((m) => m.lat))) * 110_540,
  );
  // 1.5x the span, so the cluster has air around it rather than touching the
  // panel edges, and then a third of a zoom level back on top: the map is
  // pitched, so the far half of the frame is horizon and the usable width at
  // the centre is less than the panel's.
  const fitted =
    Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180) * viewportPx) / (spanM * 1.5)) - 0.35;
  return { center: [lon, lat], zoom: Math.min(14.8, Math.max(MIN_ZOOM + 0.9, fitted)) };
}
