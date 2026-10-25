/**
 * The check page's entry point: one landmark at a time, framed and labelled.
 *
 * Why this exists as a page rather than a test
 * --------------------------------------------
 * Nothing about a 3D model is assertable in a unit test. "Is the Sands pointing
 * along the bay" is a question about pixels, and the only honest way to answer
 * it is to put the model on the real basemap, in the real projection, and look.
 * `npm run check:landmarks` drives this page with a headless browser and leaves
 * a screenshot per landmark; a reviewer looks at twelve images instead of
 * trusting twelve numbers.
 *
 * The page deliberately shares `landmarkLayers` with the dashboard rather than
 * re-implementing the placement, so what it shows is what the dashboard draws.
 */
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import { basemapStyle, registerPmtiles } from "./map/basemapStyle.ts";
import { LANDMARKS, landmarkLayers, exaggeration, type Landmark } from "./map/landmarks.ts";
import { nightLighting } from "./map/lighting.ts";

registerPmtiles();

const style = document.createElement("style");
style.textContent = `
  html, body { margin: 0; height: 100%; background: #07090c; }
  #map { position: absolute; inset: 0; }
  #hud {
    position: absolute; left: 14px; bottom: 14px; z-index: 5;
    background: rgba(7,9,12,.85); border: 1px solid var(--line, #232a33);
    border-radius: 8px; padding: 9px 13px; color: #f3efe6;
    font: 13px/1.5 system-ui, sans-serif; max-width: 420px;
  }
  #meta { display: block; margin-top: 3px; font-size: 11px; color: #8d939d; }
`;
document.head.append(style);

const first = LANDMARKS[0];
const map = new maplibregl.Map({
  container: "map",
  style: basemapStyle(),
  center: [first.lon, first.lat],
  zoom: 16.4,
  pitch: 56,
  bearing: -12,
});
const overlay = new MapboxOverlay({ interleaved: true, layers: [], effects: [nightLighting()] });
map.addControl(overlay);
// A scale bar, because the first question about any of these models is "is it
// the right size" and the only way to answer it from a screenshot is to have
// metres on the picture.
map.addControl(new maplibregl.ScaleControl({ maxWidth: 160, unit: "metric" }), "bottom-right");

function draw(zoom: number, city: string) {
  overlay.setProps({ layers: landmarkLayers({ zoom, visible: true, city }) });
}

/**
 * Centre on one landmark, three-quarters on to its own axis, and label it.
 *
 * `mapBearing` overrides the camera's heading. Passing 0 is the way to check a
 * yaw: with north up, the model's long axis should lie at the bearing printed
 * in the caption, measured clockwise from the top of the screen.
 */
function show(mark: Landmark, zoom = 16.4, mapBearing?: number) {
  map.jumpTo({
    center: [mark.lon, mark.lat],
    zoom,
    pitch: mapBearing === undefined ? 56 : 0,
    // Three-quarter view on the model's own axis: a yaw error shows up as the
    // long side facing the wrong way, and nothing is ever hidden exactly
    // behind itself.
    bearing: mapBearing ?? mark.bearing - 45,
  });
  draw(zoom, mark.city);
  document.getElementById("label")!.textContent = mark.name;
  document.getElementById("meta")!.textContent =
    `${mark.height_m} m · bearing ${mark.bearing}° (${mark.bearing_from})` +
    ` · position from ${mark.position_from}` +
    (exaggeration(mark) > 1.05 ? ` · drawn ${exaggeration(mark).toFixed(1)}×` : " · true scale");
}

map.on("load", () => {
  show(first);
  // The check script waits on this flag rather than on a timeout.
  (window as unknown as Record<string, unknown>).__landmarksReady = true;
});

// The headless check drives the page through these two.
Object.assign(window as unknown as Record<string, unknown>, {
  __landmarks: LANDMARKS,
  __show: (id: string, zoom?: number, mapBearing?: number) => {
    const mark = LANDMARKS.find((l) => l.id === id);
    if (mark) show(mark, zoom, mapBearing);
    return Boolean(mark);
  },
});
