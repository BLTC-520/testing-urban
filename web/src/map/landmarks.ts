/**
 * The 3D landmarks on the Explorer map.
 *
 * The models, the manifest and the drawing policy are the same ones the
 * command-centre dashboard uses: `scripts/landmarks/build_models.py` runs
 * Blender headless, writes one glTF binary per landmark into
 * `web/public/models/` — the single copy, which the API also serves to the
 * dashboard — and emits the manifest imported below into both front ends.
 * Nothing here models or places anything; the file is a layer builder.
 *
 * Why the Explorer has them and the Story does not
 * ------------------------------------------------
 * The Story drives its own camera through a fixed set of scenes, all of them
 * at city zoom, where a 200 m tower is a few pixels and the landmarks would
 * never appear. The Explorer is the map someone zooms into, and "where am I?"
 * is the question that arises the moment they do.
 */
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
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
  extent_m: number;
  /** How much it is enlarged to stay visible. 1 is true scale. */
  draw_scale: number;
  model: string;
  facts: string;
  confidence: string;
  position_from: string;
  bearing_from: string;
}

export const LANDMARKS: Landmark[] = manifest.landmarks;
/** Decided by the builder and carried in the manifest, not duplicated here. */
export const POLICY = manifest.policy;
export const MIN_ZOOM = POLICY.min_zoom;

const BASE = import.meta.env.BASE_URL;

export const opacityAt = (zoom: number): number =>
  Math.max(0, Math.min(1, (zoom - MIN_ZOOM) / POLICY.fade_zoom));

/**
 * A night rig for the models.
 *
 * deck.gl's default lighting is a studio with nothing in shadow, which on a
 * basemap this dark leaves a building looking like a cut-out. Everything else
 * the Explorer draws is flat — hexagons, outlines, markers, walk-shed lines —
 * so this changes nothing but the landmarks.
 */
export const nightLighting = (): LightingEffect =>
  new LightingEffect({
    ambient: new AmbientLight({ color: [150, 170, 215], intensity: 0.9 }),
    key: new DirectionalLight({ color: [220, 225, 240], intensity: 1.15, direction: [-0.5, 0.7, -1.1] }),
    fill: new DirectionalLight({ color: [255, 205, 140], intensity: 0.45, direction: [0.8, -0.6, -0.4] }),
  });

/**
 * One ScenegraphLayer per model: deck.gl loads one scenegraph per layer, and
 * twenty-six landmarks are twenty-six different buildings, so there is no
 * geometry to share. Each is a single instance of a few hundred triangles.
 *
 * A model that fails to load takes only itself out — the layer logs and draws
 * nothing, and the rest of the map is unaffected.
 */
export function landmarkLayers(opts: { zoom: number; visible: boolean }) {
  const opacity = opacityAt(opts.zoom);
  if (!opts.visible || opacity <= 0) return [];

  return LANDMARKS.map(
    (l) =>
      new ScenegraphLayer<Landmark>({
        id: `landmark-${l.id}`,
        data: [l],
        scenegraph: `${BASE}models/${l.model}`,
        getPosition: () => [l.lon, l.lat, 0],
        /*
         * deck.gl composes [pitch, yaw, roll] as Rz(yaw)·Ry(pitch)·Rx(roll).
         * The roll of 90 turns glTF's Y-up into deck.gl's Z-up, after which the
         * model's own +X axis points east — bearing 90 — so the yaw that lands
         * it on a compass bearing is 90 minus that bearing, not its negation.
         */
        getOrientation: () => [0, 90 - l.bearing, 90],
        getScale: () => [l.draw_scale, l.draw_scale, l.draw_scale],
        sizeScale: 1,
        opacity,
        _lighting: "pbr",
        // The Explorer's picking is for the data underneath: a landmark that
        // swallowed a click would stop the map answering its own question.
        pickable: false,
        updateTriggers: { getScale: [l.draw_scale], getOrientation: [l.bearing] },
      }),
  );
}
