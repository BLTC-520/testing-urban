<!--
  Landmark callouts that follow the camera: a dot on the roof, a leader line,
  and a label naming the place and its hexagon's access share.

  The rules for which landmarks get a callout live in map/anchors.ts; this
  component only feeds them the camera. Positions are recomputed every frame
  the map moves (one requestAnimationFrame per frame, however many move events
  arrive), but the set itself is re-picked at most every RESELECT_MS, so during
  a fly-through the callouts glide with their buildings instead of reshuffling
  sixty times a second.

  Why deck.gl's WebMercatorViewport and not map.project(): MapLibre's project
  ignores altitude, so under a pitched camera a callout for a 200 m roof would
  sit at the building's foot. deck's viewport takes [lon, lat, metres] and uses
  the same camera model MapboxOverlay gives the 3D buildings.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import type { Map as MlMap } from "maplibre-gl";
import { WebMercatorViewport } from "@deck.gl/core";
import { latLngToCell } from "h3-js";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import {
  LABEL, RESELECT_MS, selectAnchors, sideFor, type PlacedAnchor, type Project, type View,
} from "../map/anchors.ts";
import { LANDMARKS, type Landmark } from "../map/landmarks.ts";
import { pct } from "../lib.ts";

const props = defineProps<{ map: MlMap | null }>();

const d = useData();
const f = useFilters();

/* shallowRef: replaced wholesale every frame, never mutated. */
const placed = shallowRef<PlacedAnchor<Landmark>[]>([]);
let frame = 0;
let lastPick = -Infinity;

function cameraOf(m: MlMap): { view: View; project: Project } {
  const el = m.getContainer();
  const { lng, lat } = m.getCenter();
  const view = { width: el.clientWidth, height: el.clientHeight, zoom: m.getZoom() };
  const vp = new WebMercatorViewport({
    width: view.width, height: view.height,
    longitude: lng, latitude: lat, zoom: view.zoom,
    pitch: m.getPitch(), bearing: m.getBearing(),
  });
  const project: Project = (position) => {
    const [x, y] = vp.project([...position]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };
  return { view, project };
}

function update(repick: boolean) {
  frame = 0;
  const m = props.map;
  if (!m || (!f.landmarks && !f.focusedLandmark)) {
    placed.value = [];
    return;
  }
  const { view, project } = cameraOf(m);
  if (f.focusedLandmark) {
    const pinnedAnchor: Landmark = { ...f.focusedLandmark, pinned: true, minZoom: 0 };
    const s = project(pinnedAnchor.position);
    placed.value = s
      ? [{ anchor: pinnedAnchor, x: s.x, y: s.y, side: sideFor(s.x, s.y, view) }]
      : [];
    return;
  }
  const now = performance.now();
  if (repick || now - lastPick >= RESELECT_MS) {
    lastPick = now;
    placed.value = selectAnchors(LANDMARKS, project, view, new Set(placed.value.map((p) => p.anchor.id)));
    return;
  }
  // Between picks: keep the set, move it with the camera.
  placed.value = placed.value.flatMap((p) => {
    const s = project(p.anchor.position);
    return s ? [{ ...p, ...s, side: sideFor(s.x, s.y, view) }] : [];
  });
}

const onMove = () => { if (!frame) frame = requestAnimationFrame(() => update(false)); };
const onSettle = () => update(true);

watch(
  () => props.map,
  (m, _, onCleanup) => {
    if (!m) return;
    m.on("move", onMove);
    m.on("moveend", onSettle);
    m.on("resize", onSettle);
    if (m.loaded()) onSettle();
    else m.once("load", onSettle);
    onCleanup(() => {
      m.off("move", onMove);
      m.off("moveend", onSettle);
      m.off("resize", onSettle);
      m.off("load", onSettle);
    });
  },
  { immediate: true },
);

watch(() => f.landmarks, onSettle);
watch(() => f.focusedLandmark, onSettle);

onBeforeUnmount(() => { if (frame) cancelAnimationFrame(frame); });

/**
 * Below this many residents a hexagon's share says nothing about the place:
 * the airport's hexagon is a handful of staff quarters, and "0.0%" there would
 * read as a verdict on Changi.
 */
const MIN_RESIDENTS = 100;

/** Access share by hex id at the map's current resolution, for the label's last line. */
const shareByHex = computed(() => new Map(
  (d.cells?.hexes ?? []).filter((h) => h.pop >= MIN_RESIDENTS).map((h) => [h.hex, h.share_complete]),
));

function accessAt(l: Landmark): number | undefined {
  const [lon, lat] = l.position;
  return shareByHex.value.get(latLngToCell(lat, lon, f.res));
}

/* Geometry comes from LABEL, the same numbers the selection checks for overlap. */
const lead = (p: PlacedAnchor<Landmark>) => ({
  x: p.side.endsWith("e") ? LABEL.leadX : -LABEL.leadX,
  y: p.side.startsWith("n") ? -LABEL.leadY : LABEL.leadY,
});

/** The label hangs off the leader's end, growing away from the point. */
const boxStyle = (p: PlacedAnchor<Landmark>) => ({
  width: `${LABEL.width}px`,
  maxHeight: `${LABEL.height}px`,
  [p.side.endsWith("e") ? "left" : "right"]: `${LABEL.leadX}px`,
  [p.side.startsWith("s") ? "top" : "bottom"]: `${LABEL.leadY}px`,
});
</script>

<template>
  <div class="anchors">
    <TransitionGroup name="callout">
      <div
        v-for="p in placed" :key="p.anchor.id"
        :class="['callout', p.side]"
        :style="{ transform: `translate(${p.x}px, ${p.y}px)` }"
      >
        <svg class="leader" width="1" height="1">
          <line x1="0" y1="0" :x2="lead(p).x" :y2="lead(p).y" />
        </svg>
        <i :class="['dot', p.anchor.city]" />
        <div
          :class="['box', { focused: f.focusedLandmark?.id === p.anchor.id }]"
          :style="boxStyle(p)"
          role="button"
          tabindex="0"
          :aria-label="`Walk from ${p.anchor.name}`"
          @click.stop="f.focusLandmark(p.anchor)"
          @keydown.enter.stop="f.focusLandmark(p.anchor)"
          @keydown.space.prevent.stop="f.focusLandmark(p.anchor)"
        >
          <div class="head">
            <strong>{{ p.anchor.name }}</strong>
            <span class="kind">{{ p.anchor.kind }}</span>
          </div>
          <p class="note">{{ p.anchor.note }}</p>
          <p v-if="accessAt(p.anchor) !== undefined" class="access num">
            <b>{{ pct(accessAt(p.anchor)) }}</b> of residents here have complete {{ f.minutes }}-min access
          </p>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* Above the canvas, below the hover tooltip; never steals a hexagon's hover. */
.anchors { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 3; }

.callout { position: absolute; left: 0; top: 0; width: 0; height: 0; will-change: transform; }

.dot {
  position: absolute; left: -5px; top: -5px; width: 10px; height: 10px;
  border-radius: 50%; background: var(--paper-0);
  box-shadow: 0 0 0 2px rgba(7, 9, 12, 0.6), 0 0 12px rgba(243, 239, 230, 0.75);
}
.dot.sg { box-shadow: 0 0 0 2px var(--sg), 0 0 12px rgba(243, 239, 230, 0.75); }
.dot.jb { box-shadow: 0 0 0 2px var(--jb), 0 0 12px rgba(243, 239, 230, 0.75); }

.leader { position: absolute; left: 0; top: 0; overflow: visible; }
.leader line { stroke: rgba(243, 239, 230, 0.7); stroke-width: 1; }

.box {
  position: absolute; box-sizing: border-box; overflow: hidden;
  pointer-events: auto; cursor: pointer;
  background: rgba(11, 14, 18, 0.62);
  backdrop-filter: blur(10px);
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  padding: 7px 9px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(243, 239, 230, 0.12);
  transition: border-color 140ms, background 140ms;
}
.box:hover, .box.focused {
  background: rgba(17, 21, 27, 0.88);
  border-color: var(--ramp-5);
}

.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
/* One line of name and at most two of note keep every label inside LABEL.height. */
.head strong {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--paper-0);
}
.kind {
  flex-shrink: 0; font-size: 8px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--paper-3);
}
.note {
  margin: 3px 0 0; font-size: 10px; line-height: 1.4; color: var(--paper-2);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
}
.access {
  margin: 5px 0 0; padding-top: 5px; border-top: 1px solid var(--line);
  font-size: 10px; color: var(--paper-2); font-family: var(--font-mono);
}
.access b { color: var(--paper-0); }

.callout-enter-active, .callout-leave-active { transition: opacity 220ms ease; }
.callout-enter-from, .callout-leave-to { opacity: 0; }
</style>
