<!--
  The 3D hex map: deck.gl's H3HexagonLayer over a MapLibre basemap.

  How the two libraries are joined
  --------------------------------
  MapLibre owns the canvas and the camera; deck.gl draws into the same WebGL
  context through MapboxOverlay (from @deck.gl/mapbox). That is why there is one
  canvas and not two: a second, separately-camera'd deck canvas drifts against
  the basemap during inertial pans, which on a wall display reads as a bug.

  Why Vue only wraps it
  ---------------------
  deck.gl and MapLibre are imperative, retained-mode libraries that own their
  own render loop. The component's whole job is lifecycle: create on mount,
  push new layers when the store changes, destroy on unmount. The map instance
  itself is deliberately NOT reactive — see the shallowRef comment below.

  React equivalent: identical structure. useRef for the instances, useEffect
  with [] to create and return a cleanup, a second useEffect on the data to call
  setProps. `shallowRef` is the one Vue-specific concern: React refs never deep-
  proxy their contents, whereas Vue's `ref` would.
-->
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import type { PickingInfo } from "@deck.gl/core";
import { cellToLatLng } from "h3-js";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import { basemapStyle, registerPmtiles } from "../map/basemapStyle.ts";
import { rampAt, hexToRGB } from "../map/colors.ts";
import { landmarkLayers, landmarkView, exaggeration, MIN_ZOOM, type Landmark } from "../map/landmarks.ts";
import { nightLighting } from "../map/lighting.ts";
import type { Hex } from "../api/types.ts";
import { pct, people } from "../lib.ts";

const d = useData();
const f = useFilters();

const container = ref<HTMLDivElement | null>(null);
/*
 * shallowRef, not ref: a MapLibre Map is a large object graph holding the WebGL
 * context, and `ref` would wrap it in a deep reactive Proxy. That both costs a
 * lot and breaks identity checks the library makes internally (`this.x === x`
 * fails through a proxy). shallowRef keeps the reference reactive and the
 * object itself untouched.
 *
 * This is the main thing to know when wrapping any imperative library in Vue.
 */
const map = shallowRef<MlMap | null>(null);
const overlay = shallowRef<MapboxOverlay | null>(null);
const hovered = ref<{ x: number; y: number; hex: Hex } | null>(null);
const landmark = ref<{ x: number; y: number; mark: Landmark } | null>(null);
const ready = ref(false);
/** Landmarks are opt-out: they are the fastest way to read where you are. */
const showLandmarks = ref(true);
/*
 * The camera's zoom, mirrored into Vue state because the landmark layer's
 * opacity depends on it. Rounded to a twentieth of a level before it is stored:
 * MapLibre fires `zoom` on every frame of an inertial pinch, and rebuilding
 * twelve deck layers at 60 Hz is exactly the stutter this dashboard cannot
 * afford on a wall display.
 */
const zoom = ref(10.3);

/** What the colour encodes. Absolute level, or the scenario's change. */
const mode = computed(() => (f.isScenario && f.showDelta ? "delta" : "level"));

/**
 * How tall the columns stand, as a function of how close the camera is.
 *
 * Height encodes population, and at the overview that is exactly right: the
 * dense estates read as a ridge across the island. Zoomed in it stops working.
 * A res-8 hexagon holding 7,000 people extrudes to about 2.7 km, so at the zoom
 * where a 200 m tower is finally visible the hexagons are kilometre-high walls
 * standing in front of it, and the map shows neither the data nor the city.
 *
 * So the columns collapse over the one zoom level in which the landmarks fade
 * in, from full height to a thirtieth of it. The curve is squared rather than
 * linear because the first half of the collapse is the half that matters: a
 * column at half height is still eight hundred metres of wall.
 *
 * Nothing is lost. Colour still carries completeness at every zoom, and the
 * column was never the thing being read from six hundred metres up.
 */
const FLAT_BY = 1.0; // zoom levels over which the columns collapse
/*
 * The floor is low enough that nothing ends up *inside* a hexagon. A column
 * 80 m tall still swallows a 64 m heritage building, and a translucent prism
 * in front of a landmark hides it as effectively as an opaque one. At 0.008
 * the tallest hexagon in either city stands about 40 m, which is under every
 * landmark on the map and still enough to read as relief.
 */
const FLAT_FLOOR = 0.008;
function elevationScaleAt(z: number): number {
  if (z <= MIN_ZOOM) return 1;
  const t = Math.min(1, (z - MIN_ZOOM) / FLAT_BY);
  return (1 - t) ** 2 * (1 - FLAT_FLOOR) + FLAT_FLOOR;
}

/**
 * How opaque the hexagons are, as a function of the same zoom.
 *
 * Flattening the columns is not enough on its own: a flat carpet at full
 * opacity still hides the streets the landmarks are standing in. Close in, the
 * fill thins to let the basemap through, which is the point at which the map
 * starts to look like a place rather than a chart.
 */
function fillAlphaAt(z: number): number {
  if (z <= MIN_ZOOM) return 215;
  return Math.round(215 - 100 * Math.min(1, (z - MIN_ZOOM) / FLAT_BY));
}

/** Baseline shares by hex id, so a delta needs no second layer. */
const baselineByHex = computed(() => {
  const m = new Map<string, number>();
  // Only meaningful under a scenario; the store holds both responses then.
  for (const h of d.baselineCells?.hexes ?? []) m.set(h.hex, h.share_complete);
  return m;
});

function buildLayers() {
  const hexes = d.cells?.hexes ?? [];
  const selected = f.selection?.hex ?? null;
  const base = baselineByHex.value;
  const delta = mode.value === "delta";

  return [
    new H3HexagonLayer<Hex>({
      id: "completeness",
      data: hexes,
      getHexagon: (h) => h.hex,
      extruded: true,
      /*
       * Height encodes population, colour encodes accessibility. Two different
       * measures on two different channels — never the same measure twice,
       * which would just be a thicker bar.
       *
       * Population is cube-rooted, not linear: a linear scale makes one dense
       * estate a spike that hides everything around it. The exponent is a
       * presentation choice and is stated in the legend.
       */
      getElevation: (h) => Math.cbrt(h.pop) * 140,
      elevationScale: elevationScaleAt(zoom.value),
      getFillColor: (h) => {
        if (delta) {
          const before = base.get(h.hex);
          if (before === undefined) return [34, 42, 53, 160];
          return hexToRGB(h.share_complete - before);
        }
        return rampAt(h.share_complete, fillAlphaAt(zoom.value));
      },
      getLineColor: (h) => (h.hex === selected ? [243, 239, 230, 255] : [0, 0, 0, 0]),
      getLineWidth: (h) => (h.hex === selected ? 3 : 0),
      lineWidthUnits: "pixels",
      stroked: true,
      filled: true,
      pickable: true,
      autoHighlight: true,
      highlightColor: [243, 239, 230, 70],
      material: { ambient: 0.55, diffuse: 0.6, shininess: 32, specularColor: [40, 60, 80] },
      // deck.gl diffs accessors by this key rather than re-running them all.
      updateTriggers: {
        getFillColor: [f.minutes, f.speed, f.scenario, mode.value, fillAlphaAt(zoom.value)],
        getElevation: [f.city],
        getLineColor: [selected],
        getLineWidth: [selected],
      },
      transitions: { getFillColor: 180, getElevation: 300 },
      onHover: (info: PickingInfo<Hex>) => {
        hovered.value = info.object ? { x: info.x, y: info.y, hex: info.object } : null;
      },
      onClick: (info: PickingInfo<Hex>) => {
        if (!info.object) return;
        void selectHex(info.object);
      },
    }),
    // The landmarks go last so they pick above the hexagons: at this pitch a
    // tower stands over several of them and the building is what the pointer
    // is actually on.
    ...landmarkLayers({
      zoom: zoom.value,
      visible: showLandmarks.value,
      city: f.city,
      onHover: (info) => {
        landmark.value = info.object ? { x: info.x, y: info.y, mark: info.object } : null;
      },
      onClick: (mark) => flyToLandmark(mark),
    }),
  ];
}

/**
 * Switching the landmarks on from the overview takes the camera to them.
 *
 * Without this the toggle does nothing visible at the zoom the dashboard opens
 * at, which is the same as the feature not existing.
 */
function toggleLandmarks() {
  showLandmarks.value = !showLandmarks.value;
  if (!showLandmarks.value || zoom.value >= MIN_ZOOM) return;
  const view = landmarkView(f.city, container.value?.clientWidth ?? 900);
  if (view) {
    map.value?.easeTo({ center: view.center, zoom: view.zoom, pitch: 52, duration: 1400 });
  }
}

/** Clicking a landmark frames it: close enough to read, still pitched. */
function flyToLandmark(mark: Landmark) {
  map.value?.easeTo({
    center: [mark.lon, mark.lat],
    zoom: Math.max(zoom.value, 15.2),
    pitch: 56,
    duration: 1100,
  });
}

/**
 * Clicking a hexagon scopes the side panels to its district.
 *
 * The hexagon knows which cells it covers but not which neighbourhood they are
 * in — that lives on the resolution-10 rows — so this asks the API for one
 * cell inside it. At res 8 a parent covers ~49 children; the centre cell is a
 * good enough representative for a district label.
 */
async function selectHex(h: Hex) {
  const [lat, lng] = cellToLatLng(h.hex);
  f.select({ hex: h.hex, unit: null, unitName: null });
  const found = await d.lookupUnit(lat, lng);
  if (found && f.selection?.hex === h.hex) {
    f.select({ hex: h.hex, unit: found.unit, unitName: found.unitName });
  }
}

/** Re-centre when the city changes; the two are far enough apart to need it. */
function flyToCity() {
  const c = d.summary?.cities.find((x) => x.id === f.city);
  if (!c || !map.value) return;
  map.value.easeTo({
    center: [c.center_lon, c.center_lat],
    zoom: c.zoom - 0.3,
    pitch: 42,
    bearing: -12,
    duration: 900,
  });
}

onMounted(() => {
  if (!container.value) return;
  // The pmtiles:// protocol handler must exist before a style referencing it loads.
  registerPmtiles();
  const c = d.summary?.cities.find((x) => x.id === f.city);
  const m = new maplibregl.Map({
    container: container.value,
    style: basemapStyle(),
    center: [c?.center_lon ?? 103.82, c?.center_lat ?? 1.355],
    zoom: (c?.zoom ?? 10.6) - 0.3,
    pitch: 42,
    bearing: -12,
    attributionControl: { compact: true },
    // A wall display is not interacted with; a desk review is. Keep both usable
    // but never let a stray scroll zoom the whole page instead.
    cooperativeGestures: false,
  });
  m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

  const o = new MapboxOverlay({ interleaved: true, layers: [], effects: [nightLighting()] });
  m.addControl(o);

  m.on("load", () => {
    ready.value = true;
    zoom.value = m.getZoom();
    o.setProps({ layers: buildLayers() });
  });

  m.on("zoom", () => {
    const z = Math.round(m.getZoom() * 20) / 20;
    if (z !== zoom.value) zoom.value = z;
  });

  map.value = m;
  overlay.value = o;
});

onBeforeUnmount(() => {
  // MapLibre holds a WebGL context and a resize listener; leaking it across a
  // hot reload exhausts the browser's context limit after a dozen saves.
  overlay.value?.finalize();
  map.value?.remove();
  overlay.value = null;
  map.value = null;
});

/** Push new layers whenever the data or the encoding changes. */
watch(
  () => [d.cells, d.baselineCells, f.selection?.hex, mode.value, zoom.value,
         showLandmarks.value, f.city] as const,
  () => { if (ready.value) overlay.value?.setProps({ layers: buildLayers() }); },
  { deep: false },
);

watch(() => f.city, () => flyToCity());

const legendStops = computed(() =>
  mode.value === "delta"
    ? [
        { label: "no change", color: "rgb(34,42,53)" },
        { label: "+5 pp", color: "rgba(255,209,102,.55)" },
        { label: "+15 pp", color: "rgb(255,209,102)" },
      ]
    : [0, 0.25, 0.5, 0.75, 1].map((v) => ({
        label: `${Math.round(v * 100)}%`,
        color: `rgb(${rampAt(v).slice(0, 3).join(",")})`,
      })),
);
</script>

<template>
  <section class="panel map-panel">
    <div class="panel-head">
      <h2 class="panel-title">
        Complete {{ f.minutes }}-minute access · H3 r{{ f.res }}
      </h2>
      <span class="panel-note">
        colour = {{ mode === "delta" ? "change vs baseline" : "share of residents" }} ·
        height = population (cube root)<template v-if="zoom >= 13">
        · buildings: OSM footprints at a uniform 9 m, no heights in the source</template>
      </span>
    </div>

    <div class="canvas-wrap">
      <div ref="container" class="canvas" />

      <div class="legend">
        <span class="legend-label">
          {{ mode === "delta" ? "Change" : "Complete access" }}
        </span>
        <div class="stops">
          <span v-for="s in legendStops" :key="s.label" class="stop">
            <i :style="{ background: s.color }" />{{ s.label }}
          </span>
        </div>
      </div>

      <div class="res-switch">
        <button
          v-for="r in [7, 8]" :key="r"
          :class="['chip', { on: f.res === r }]"
          @click="f.res = r"
        >r{{ r }}</button>
        <button
          :class="['chip', { on: showLandmarks }]"
          :title="zoom < MIN_ZOOM
            ? 'Landmarks appear from zoom 12.3 — below that a tower is five pixels tall. Switching them on from here takes the camera to them.'
            : 'Blender-built landmarks at their real size and bearing'"
          @click="toggleLandmarks"
        >landmarks<span v-if="showLandmarks && zoom < MIN_ZOOM" class="dim"> · zoom in</span></button>
      </div>

      <!--
        Landmark card. Separate from the hexagon tooltip because it answers a
        different question: not "what is the figure here" but "what am I
        looking at, and how much of it is measured".
      -->
      <div
        v-if="landmark"
        class="tip mark"
        :style="{ left: `${landmark.x + 14}px`, top: `${landmark.y + 14}px` }"
      >
        <strong>{{ landmark.mark.name }}</strong><br />
        <span class="dim">{{ landmark.mark.facts }}</span><br />
        <span class="num prov">
          {{ Math.round(landmark.mark.height_m) }} m ·
          {{ landmark.mark.confidence }} ·
          {{ exaggeration(landmark.mark) > 1.05
            ? `drawn ${exaggeration(landmark.mark).toFixed(1)}x`
            : "true scale" }}
        </span>
      </div>

      <!-- Hover tooltip: the per-mark hover layer the dataviz rules require. -->
      <div
        v-if="hovered"
        class="tip num"
        :style="{ left: `${hovered.x + 14}px`, top: `${hovered.y + 14}px` }"
      >
        <strong>{{ pct(hovered.hex.share_complete) }}</strong> complete<br />
        {{ people(hovered.hex.pop) }} residents<br />
        <span class="dim">{{ hovered.hex.mean_categories.toFixed(1) }} of 6 essentials</span><br />
        <span class="dim">{{ hovered.hex.cells }} cells</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.map-panel { height: 100%; overflow: hidden; }
.canvas-wrap { position: relative; flex: 1 1 auto; min-height: 0; margin: 0 1px 1px; }
.canvas {
  position: absolute; inset: 0;
  border-radius: 0 0 var(--radius) var(--radius);
  overflow: hidden;
}
.canvas :deep(.maplibregl-ctrl-attrib) {
  background: rgba(7, 9, 12, 0.72); font-size: 9px;
}
.canvas :deep(.maplibregl-ctrl-attrib a) { color: var(--paper-3); }

.legend {
  position: absolute; left: 12px; bottom: 12px;
  background: rgba(7, 9, 12, 0.82);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 7px 10px;
  pointer-events: none;
}
.legend-label {
  display: block; font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--paper-3); margin-bottom: 5px;
}
.stops { display: flex; gap: 10px; }
.stop {
  display: flex; align-items: center; gap: 4px;
  font-size: 10px; color: var(--paper-2);
  font-family: var(--font-mono);
}
.stop i { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }

.res-switch { position: absolute; right: 12px; top: 12px; display: flex; gap: 4px; }
.chip {
  background: rgba(7, 9, 12, 0.82); border: 1px solid var(--line);
  border-radius: 5px; padding: 2px 8px;
  font-size: 10px; font-family: var(--font-mono); color: var(--paper-3);
}
.chip.on { color: var(--paper-0); border-color: var(--line-strong); background: var(--ink-4); }

.tip {
  position: absolute; z-index: 5; pointer-events: none;
  background: var(--ink-4); border: 1px solid var(--line-strong);
  border-radius: 6px; padding: 6px 9px;
  font-size: 11px; color: var(--paper-0); line-height: 1.45;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
}
.tip strong { font-size: 13px; }
.tip .dim { color: var(--paper-2); }

/* The landmark card carries a sentence, so it wraps where the hex tip does not. */
.tip.mark { max-width: 280px; white-space: normal; }
.tip.mark .prov {
  display: inline-block; margin-top: 5px;
  font-size: 10px; color: var(--paper-3); letter-spacing: 0.02em;
}
.chip .dim { color: var(--paper-3); }
</style>
