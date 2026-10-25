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
import {
  BUILDINGS_VIEW, buildingsFocus, buildingsLayer, cityMaskLayer, hexStyle, ionToken,
} from "../map/buildings.ts";
import {
  buildLandmarkMeshes, landmarkMeshLayer, type LandmarkMeshPart,
} from "../map/landmarkMeshes.ts";
import { LANDMARKS } from "../map/landmarks.ts";
import {
  BAND_COLORS, CATEGORY_RGB, activeRouteLayer, isochroneLayer, nearestPoiMarkers, walkMarkerLayers, type NearestMarker,
} from "../map/walkFocus.ts";
import { STUDY_AREA } from "../map/studyArea.ts";
import { useWalkFocusController } from "../composables/useWalkFocus.ts";
import FamousLandmarksBar from "./FamousLandmarksBar.vue";
import LandmarkCallouts from "./LandmarkCallouts.vue";
import type { Hex } from "../api/types.ts";
import { int, pct, people, titleise } from "../lib.ts";

const d = useData();
const f = useFilters();

/** Optional Cesium ion token for streaming OSM Buildings on top of the open-source 3D landmark meshes. */
const ION_TOKEN = ionToken(import.meta.env);
const showBuildings = computed(() => f.buildings);

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
const hoveredLandmark = ref<{ x: number; y: number; part: LandmarkMeshPart } | null>(null);
const hoveredPoi = ref<{ x: number; y: number; marker: NearestMarker } | null>(null);
const ready = ref(false);

const cityMeshParts = computed(() =>
  buildLandmarkMeshes(LANDMARKS.filter((l) => l.city === f.city)),
);

const {
  iso: walkIso,
  reached: walkReached,
  reveal: walkReveal,
  suppressBuildingFrame,
} = useWalkFocusController(map, ION_TOKEN);

const speedMps = computed(() => d.summary?.meta.speeds[f.speed] ?? 1.2);
const basket = computed(
  () => d.summary?.meta.basket ?? ["groceries", "healthcare", "education", "green_space", "transit", "dining"],
);

/** What the colour encodes. Absolute level, or the scenario's change. */
const mode = computed(() => (f.isScenario && f.showDelta ? "delta" : "level"));

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
  const focused = f.focusedLandmark !== null;
  const base = baselineByHex.value;
  const delta = mode.value === "delta";
  const style = hexStyle(showBuildings.value, focused);

  const hexLayer =
    new H3HexagonLayer<Hex>({
      id: "completeness",
      data: hexes,
      getHexagon: (h) => h.hex,
      extruded: style.extruded,
      opacity: style.opacity,
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
      elevationScale: 1,
      getFillColor: (h) => {
        if (delta) {
          const before = base.get(h.hex);
          if (before === undefined) return [34, 42, 53, 160];
          return hexToRGB(h.share_complete - before);
        }
        return rampAt(h.share_complete);
      },
      getLineColor: (h) => (h.hex === selected ? [243, 239, 230, 255] : [0, 0, 0, 0]),
      getLineWidth: (h) => (h.hex === selected ? 3 : 0),
      lineWidthUnits: "pixels",
      stroked: true,
      filled: true,
      pickable: !focused,
      autoHighlight: !focused,
      highlightColor: [243, 239, 230, 70],
      material: { ambient: 0.55, diffuse: 0.6, shininess: 32, specularColor: [40, 60, 80] },
      // deck.gl diffs accessors by this key rather than re-running them all.
      updateTriggers: {
        getFillColor: [f.minutes, f.speed, f.scenario, mode.value],
        getElevation: [f.city],
        getLineColor: [selected],
        getLineWidth: [selected],
      },
      transitions: { getFillColor: 180, getElevation: 300 },
      onHover: (info: PickingInfo<Hex>) => {
        hovered.value = !focused && info.object ? { x: info.x, y: info.y, hex: info.object } : null;
      },
      onClick: (info: PickingInfo<Hex>) => {
        if (!info.object) return;
        void selectHex(info.object);
      },
    });

  // Buildings after hexagons, so they draw over the flattened ground plane;
  // the mask (the same hexagons, never drawn) clips them to this city.
  const baseLayers = [
    ...(showBuildings.value && ION_TOKEN
      ? [cityMaskLayer(hexes), hexLayer, buildingsLayer(ION_TOKEN, f.city, f.buildingColorMode)]
      : [hexLayer]),
    ...(showBuildings.value || f.landmarks || focused
      ? [
          landmarkMeshLayer({
            meshParts: cityMeshParts.value,
            focusedId: f.focusedLandmark?.id ?? null,
            hoveredId: hoveredLandmark.value?.part.landmarkId ?? null,
            onHover: (info) => {
              hoveredLandmark.value = info.object
                ? { x: info.x, y: info.y, part: info.object }
                : null;
            },
            onClick: (info) => {
              if (!info.object) return;
              hoveredLandmark.value = null;
              f.focusLandmark(info.object.landmark, null, true);
            },
          }),
        ]
      : []),
  ];

  if (!focused || !walkIso.value) return baseLayers;

  const markers = nearestPoiMarkers(walkReached.value, basket.value, f.minutes, walkReveal.value);
  const activeCat = f.activeRouteCategory;
  const activeTarget = activeCat ? walkReached.value?.nearest[activeCat] ?? null : null;
  const activeRoutePts =
    activeTarget && walkIso.value.routeTo
      ? walkIso.value.routeTo(activeTarget.lon, activeTarget.lat)
      : null;

  return [
    ...baseLayers,
    isochroneLayer("walk-isochrone", walkIso.value.segments, walkReveal.value, speedMps.value),
    ...(activeRoutePts && activeCat
      ? [
          activeRouteLayer(
            "walk-shortest-route",
            activeRoutePts,
            CATEGORY_RGB[activeCat] ?? [255, 209, 102],
          ),
        ]
      : []),
    ...walkMarkerLayers(walkIso.value.startNode, markers, {
      activeCategory: activeCat,
      onHoverMarker: (m, x, y) => {
        hoveredPoi.value = m ? { x, y, marker: m } : null;
        f.setActiveRouteCategory(m ? m.category : null);
      },
      onClickMarker: (m) => {
        f.setActiveRouteCategory(f.activeRouteCategory === m.category ? null : m.category);
      },
    }),
  ];
}

/**
 * Buildings are only legible up close, so switching them on moves the camera
 * in and tilts it; switching off returns to the whole-city view.
 */
function frameBuildings(on: boolean) {
  if (!map.value) return;
  if (!on) return flyToCity();
  map.value.easeTo({
    center: buildingsFocus(f.city, f.selection ? cellToLatLng(f.selection.hex) : null),
    zoom: BUILDINGS_VIEW.zoom,
    pitch: BUILDINGS_VIEW.pitch,
    duration: 1200,
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
    // The camera stays over the study area: nothing outside it has data.
    maxBounds: STUDY_AREA,
    attributionControl: { compact: true },
    // A wall display is not interacted with; a desk review is. Keep both usable
    // but never let a stray scroll zoom the whole page instead.
    cooperativeGestures: false,
  });
  m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

  const o = new MapboxOverlay({ interleaved: true, layers: [] });
  m.addControl(o);

  m.on("load", () => {
    ready.value = true;
    o.setProps({ layers: buildLayers() });
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
  () => [
    d.cells, d.baselineCells, f.selection?.hex, mode.value, showBuildings.value,
    f.buildingColorMode, f.landmarks, f.focusedLandmark, hoveredLandmark.value?.part.landmarkId,
    f.activeRouteCategory, walkIso.value, walkReached.value, walkReveal.value, speedMps.value,
  ] as const,
  () => {
    if (f.focusedLandmark) hovered.value = null;
    if (ready.value) overlay.value?.setProps({ layers: buildLayers() });
  },
  { deep: false },
);

watch(() => f.city, () => {
  if (!f.focusedLandmark) {
    if (showBuildings.value) frameBuildings(true);
    else flyToCity();
  }
});
watch(showBuildings, (on) => {
  if (!f.focusedLandmark && !suppressBuildingFrame.value) frameBuildings(on);
});

const legendStops = computed(() => {
  if (f.focusedLandmark) {
    return ["0–5 min", "5–10 min", "10–15 min", "15+ min"].map((label, i) => ({
      label,
      color: `rgb(${BAND_COLORS[i].join(",")})`,
    }));
  }
  return mode.value === "delta"
    ? [
        { label: "no change", color: "rgb(34,42,53)" },
        { label: "+5 pp", color: "rgba(255,209,102,.55)" },
        { label: "+15 pp", color: "rgb(255,209,102)" },
      ]
    : [0, 0.25, 0.5, 0.75, 1].map((v) => ({
        label: `${Math.round(v * 100)}%`,
        color: `rgb(${rampAt(v).slice(0, 3).join(",")})`,
      }));
});
</script>

<template>
  <section class="panel map-panel">
    <div class="panel-head">
      <h2 class="panel-title">
        Complete {{ f.minutes }}-minute access · H3 r{{ f.res }}
      </h2>
      <span class="panel-note">
        colour = {{ mode === "delta" ? "change vs baseline" : "share of residents" }} ·
        <template v-if="showBuildings">buildings = OpenStreetMap, via Cesium ion</template>
        <template v-else>height = population (cube root)</template>
      </span>
    </div>

    <div class="canvas-wrap">
      <div ref="container" class="canvas" />
      <LandmarkCallouts :map="map" />
      <FamousLandmarksBar />

      <div class="legend">
        <span class="legend-label">
          {{ f.focusedLandmark ? "Walking routes (5-min bands)" : mode === "delta" ? "Change" : "Complete access" }}
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
          :class="['chip', { on: f.buildings }]"
          :aria-pressed="f.buildings"
          @click="f.toggleBuildings()"
        >3D buildings</button>
        <button
          v-if="showBuildings"
          :class="['chip', { on: f.buildingColorMode === 'access' }]"
          :aria-pressed="f.buildingColorMode === 'access'"
          title="Switch 3D building colour palette"
          @click="f.toggleBuildingColorMode()"
        >{{ f.buildingColorMode === "role" ? "Role colours" : "Twin tint" }}</button>
        <button
          :class="['chip', { on: f.landmarks }]"
          :aria-pressed="f.landmarks"
          @click="f.toggleLandmarks()"
        >Landmarks</button>
      </div>

      <!-- Cesium ion's terms ask for visible credit wherever its data is shown. -->
      <div v-if="showBuildings" class="credit">
        3D meshes:
        <template v-if="ION_TOKEN">
          <a href="https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/" target="_blank" rel="noopener">Cesium OSM Buildings</a> ·
        </template>
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors
      </div>

      <!-- Hover tooltip: 3D POI beacon, 3D landmark mesh, or H3 hexagon. -->
      <div
        v-if="hoveredPoi"
        class="tip num"
        :style="{ left: `${hoveredPoi.x + 14}px`, top: `${hoveredPoi.y + 14}px` }"
      >
        <span class="dim">{{ titleise(hoveredPoi.marker.category) }} · nearest within budget</span><br />
        <strong>{{ hoveredPoi.marker.name || titleise(hoveredPoi.marker.category) }}</strong><br />
        <b>{{ hoveredPoi.marker.minutes.toFixed(1) }} min</b> walk ({{ int(Math.round(hoveredPoi.marker.distanceM)) }} m)
      </div>
      <div
        v-else-if="hoveredLandmark"
        class="tip num"
        :style="{ left: `${hoveredLandmark.x + 14}px`, top: `${hoveredLandmark.y + 14}px` }"
      >
        <span class="dim">{{ hoveredLandmark.part.landmark.kind.toUpperCase() }} · {{ hoveredLandmark.part.partName }} ({{ hoveredLandmark.part.heightM }} m)</span><br />
        <strong>{{ hoveredLandmark.part.landmark.name }}</strong><br />
        <span class="dim">Click 3D building to walk the street network</span>
      </div>
      <div
        v-else-if="hovered"
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

.credit {
  position: absolute; left: 12px; bottom: 66px;
  background: rgba(7, 9, 12, 0.82); border: 1px solid var(--line);
  border-radius: 5px; padding: 3px 8px;
  font-size: 9px; color: var(--paper-3);
}
.credit a { color: var(--paper-2); }

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
</style>
