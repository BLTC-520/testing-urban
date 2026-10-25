/**
 * One lighting rig for everything deck.gl draws on this map.
 *
 * deck.gl's default lighting is a studio: strong ambient plus two bright
 * directionals, aimed so that nothing is ever in shadow. That is a sensible
 * default for a chart and the wrong one here, where the basemap is a night
 * survey and the point of the 3D is relief — a hex column should be readably
 * brighter on one side, and a tower should cast its lit face towards the
 * viewer and keep its dark one dark.
 *
 * The numbers are chosen against the basemap, not in the abstract:
 *
 * · ambient is low and cool, matching the #0a1743 night sky measured off the
 *   reference photographs in scripts/landmarks/refs/analysis.json;
 * · the key light is weak and low, from the north-east, so the hex columns get
 *   one lit face and one shaded one rather than a flat top;
 * · the fill is weaker still and warm, standing in for the city's own glow
 *   bouncing up off the ground — without it the unlit sides go to pure black
 *   and the extrusions lose their edges against the basemap.
 *
 * The landmarks are mostly emissive and barely need this. The hexagons need
 * all of it.
 */
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";

const ambient = new AmbientLight({
  color: [150, 170, 215],
  intensity: 0.9,
});

/** Key: low, from the north-east, the direction the map's camera looks from. */
const key = new DirectionalLight({
  color: [220, 225, 240],
  intensity: 1.15,
  direction: [-0.5, 0.7, -1.1],
});

/** Fill: warm, from the opposite side, standing in for the city's own glow. */
const fill = new DirectionalLight({
  color: [255, 205, 140],
  intensity: 0.45,
  direction: [0.8, -0.6, -0.4],
});

export const nightLighting = (): LightingEffect =>
  new LightingEffect({ ambient, key, fill });
