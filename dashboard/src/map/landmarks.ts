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
 * with one documented exception: anything under the manifest's `min_drawn_m`
 * across its largest dimension is scaled up to it, because the Merlion is
 * 8.6 m tall and would otherwise be a single pixel at any zoom this dashboard
 * uses. The exaggeration is reported in the hover card rather than hidden, and
 * the number itself comes from the builder, not from here.
 */
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import manifest from "./landmarks.json";

/*
 * The models are served by the API from web/public/models, the same single
 * copy the published site uses — see the @fastify/static registration in
 * server/src/app.ts and the dev-server proxy in vite.config.ts. Building them
 * into dashboard/public would have meant two copies of 1.3 MB of geometry in
 * one repository, which is the thing basemap.pmtiles is already careful not
 * to do.
 */
const API = import.meta.env.VITE_API_BASE ?? "";
const modelUrl = (file: string) => `${API}/models/${file}`;

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
  /** How much it is enlarged to stay visible. 1 is true scale. */
  draw_scale: number;
  model: string;
  facts: string;
  /** How well sourced the dimensions are: published / derived / estimated. */
  confidence: string;
  position_from: string;
  bearing_from: string;
}

export const LANDMARKS: Landmark[] = manifest.landmarks;

/**
 * The drawing policy, decided by the builder and carried in the manifest.
 *
 * It lives there rather than here because the dashboard is not the only thing
 * that draws these: the Explorer on the published site draws the same models
 * from the same manifest, and a policy copied into two front ends is a policy
 * that will disagree with itself.
 */
export const POLICY = manifest.policy;

/** Below this zoom the layer is not drawn at all; see POLICY. */
export const MIN_ZOOM = POLICY.min_zoom;

/**
 * How much a landmark is enlarged to stay visible. 1 means true scale.
 *
 * The number is computed by the builder from the model's measured extent and
 * carried in the manifest; this is only the accessor. The hover card prints it
 * when it is not 1, because a map symbol that is not to scale is ordinary and
 * one that does not admit it is not.
 */
export const exaggeration = (l: Landmark): number => l.draw_scale;

export const opacityAt = (zoom: number): number =>
  Math.max(0, Math.min(1, (zoom - MIN_ZOOM) / POLICY.fade_zoom));

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
 * deck.gl loads one scenegraph per layer, so twenty-six models means twenty-six
 * layers. That is cheaper than it sounds: each is a single instance of a few
 * hundred triangles, and deck.gl's layer overhead is far smaller than the draw
 * it replaces. The alternative — one layer with an instanced mesh — would need
 * all twenty-six landmarks to share one geometry, which is the opposite of the
 * point.
 *
 * It also fails well, which was checked rather than assumed: deleting one .glb
 * and loading the map leaves that one landmark absent, one console error from
 * deck.gl's loader, and everything else — the other twenty-five, the hexagons,
 * the basemap — drawing normally. Decoration that can take the map down with
 * it would not be worth shipping.
 */
export function landmarkLayers(opts: LandmarkLayerOptions) {
  const opacity = opacityAt(opts.zoom);
  if (!opts.visible || opacity <= 0) return [];

  return LANDMARKS.map((l) =>
    new ScenegraphLayer<Landmark>({
      id: `landmark-${l.id}`,
      data: [l],
      scenegraph: modelUrl(l.model),
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
      getScale: () => [l.draw_scale, l.draw_scale, l.draw_scale],
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
        getScale: [l.draw_scale],
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
 * The centre is the *median* landmark, not the mean. Singapore's set is a dozen
 * buildings around Marina Bay and then a pagoda at Jurong Lake, a bridge on the
 * Southern Ridges, Jewel out at Changi and a checkpoint at Woodlands — spread
 * deliberately, so that zooming into any part of the island lands on something.
 * A mean of that set puts the camera in the middle of the island looking at
 * nothing; the median puts it where most of them are. The zoom then fits
 * whatever sits within 3 km of that median, which is the cluster rather than
 * the outliers.
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
