/**
 * Ported from web/src/explore/useIsochrone.ts and adapted for Vue + MapLibre.
 *
 * Orchestrates the two-stage landmark walk-focus choreography:
 *   1. Focus shot: fly (~1.6 s) to street level (zoom 16.5, pitch 62°) facing
 *      the building from the nearest street-graph node.
 *   2. Route reveal + pullback: once settled, grow the 5-minute-banded street
 *      segments outward over 3.5 s while easing the camera back at the same
 *      bearing to frame the reachable walk-shed.
 *
 * Follows HexMap.vue's shallowRef pattern for large imperative data (Isochrone
 * holds thousands of segments and typed arrays that must not be deep-proxied).
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from "vue";
import type { Map as MlMap } from "maplibre-gl";
import { useData } from "../stores/data.ts";
import { useFilters, type CameraSnapshot } from "../stores/filters.ts";
import { loadPois, reachedPois, streetGraph, type Reached } from "../map/pois.ts";
import type { Isochrone } from "../map/streetGraph.ts";
import {
  FOCUS_SHOT,
  REVEAL_DURATION_MS,
  bearingToBuilding,
  pullbackCamera,
} from "../map/walkFocus.ts";

export type WalkStatus = "idle" | "loading" | "ready" | "offnetwork" | "error";

const status = ref<WalkStatus>("idle");
const iso = shallowRef<Isochrone | null>(null);
const reached = shallowRef<Reached | null>(null);
const reveal = ref(0);
const focusBearing = ref(-12);

/** Shared read-only reactive state for the map layers and focus info panel. */
export function useWalkFocusState() {
  return { status, iso, reached, reveal, focusBearing };
}

function snapshotOf(m: MlMap): CameraSnapshot {
  const c = m.getCenter();
  return {
    center: [c.lng, c.lat],
    zoom: m.getZoom(),
    pitch: m.getPitch(),
    bearing: m.getBearing(),
  };
}

/**
 * Bind the walk-focus state machine and Escape handler to the MapLibre instance
 * in HexMap.vue.
 */
export function useWalkFocusController(
  map: ShallowRef<MlMap | null>,
  ionToken: string | null,
) {
  const d = useData();
  const f = useFilters();

  let runId = 0;
  let raf = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCamera: CameraSnapshot | null = null;
  /** Suppresses HexMap's showBuildings watcher while focus mode owns the camera. */
  const suppressBuildingFrame = ref(false);

  const speedMps = computed(() => d.summary?.meta.speeds[f.speed] ?? 1.2);

  function cancelPending() {
    runId++;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  function animateReveal(token: number, cutoffM: number, durationMs: number) {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dur = reduced ? 0 : durationMs;
    if (dur <= 0) {
      reveal.value = cutoffM;
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      if (token !== runId) return;
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - p) ** 3;
      reveal.value = eased * cutoffM;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  watch(
    () => f.focusedLandmark,
    async (lm, prevLm) => {
      cancelPending();
      const token = runId;
      const m = map.value;

      if (!lm) {
        status.value = "idle";
        iso.value = null;
        reached.value = null;
        reveal.value = 0;
        const restoreCam = lastCamera;
        lastCamera = null;
        if (m && restoreCam && (!prevLm || prevLm.city === f.city)) {
          suppressBuildingFrame.value = true;
          m.easeTo({ ...restoreCam, duration: 900 });
          setTimeout(() => { suppressBuildingFrame.value = false; }, 50);
        }
        return;
      }

      // Capture the pre-focus camera on initial entry into focus mode.
      if (!prevLm) {
        if (!f.savedCamera && m) {
          const snap = snapshotOf(m);
          f.savedCamera = snap;
          f.savedBuildings = f.buildings;
          f.savedLandmarks = f.landmarks;
        }
        lastCamera = f.savedCamera;
        if (ionToken && !f.buildings) {
          suppressBuildingFrame.value = true;
          f.buildings = true;
          setTimeout(() => { suppressBuildingFrame.value = false; }, 50);
        }
      }

      status.value = "loading";
      iso.value = null;
      reached.value = null;
      reveal.value = 0;

      const [lon, lat] = lm.position;
      const speed = speedMps.value;
      const budgetMin = f.minutes;
      const cutoffM = budgetMin * 60 * speed;

      try {
        const [computedIso, pois] = await Promise.all([
          streetGraph().isochrone(lon, lat, cutoffM),
          loadPois(lm.city),
        ]);
        if (token !== runId) return;

        const currentBearing = m ? m.getBearing() : -12;
        const brg = computedIso
          ? bearingToBuilding(computedIso.startNode, [lon, lat], currentBearing)
          : currentBearing;
        focusBearing.value = brg;

        // Stage 1: Focus shot facing the building from the street.
        if (m) {
          m.easeTo({
            center: [lon, lat],
            zoom: FOCUS_SHOT.zoom,
            pitch: FOCUS_SHOT.pitch,
            bearing: brg,
            duration: FOCUS_SHOT.duration,
          });
        }

        if (!computedIso) {
          status.value = "offnetwork";
          return;
        }

        iso.value = computedIso;
        reached.value = reachedPois(computedIso, pois, speed, budgetMin);
        status.value = "ready";

        // Stage 2: Once the focus shot settles, spread routes outward and pull back.
        settleTimer = setTimeout(() => {
          if (token !== runId) return;
          animateReveal(token, cutoffM, REVEAL_DURATION_MS);
          if (map.value) {
            const pull = pullbackCamera(computedIso.segments, [lon, lat], brg);
            map.value.easeTo({ ...pull, duration: REVEAL_DURATION_MS });
          }
        }, FOCUS_SHOT.duration);
      } catch (err) {
        if (token !== runId) return;
        console.warn(err);
        status.value = "error";
      }
    },
  );

  // Recompute walk-shed and panel numbers when budget or speed changes during focus.
  watch(
    () => [f.minutes, speedMps.value] as const,
    async ([budgetMin, speed]) => {
      const lm = f.focusedLandmark;
      if (!lm) return;
      cancelPending();
      const token = runId;
      const [lon, lat] = lm.position;
      const cutoffM = budgetMin * 60 * speed;
      try {
        const [computedIso, pois] = await Promise.all([
          streetGraph().isochrone(lon, lat, cutoffM),
          loadPois(lm.city),
        ]);
        if (token !== runId) return;
        if (!computedIso) {
          status.value = "offnetwork";
          iso.value = null;
          reached.value = null;
          reveal.value = 0;
          return;
        }
        iso.value = computedIso;
        reached.value = reachedPois(computedIso, pois, speed, budgetMin);
        reveal.value = cutoffM;
        status.value = "ready";
        if (map.value) {
          const pull = pullbackCamera(computedIso.segments, [lon, lat], focusBearing.value);
          map.value.easeTo({ ...pull, duration: 600 });
        }
      } catch (err) {
        if (token !== runId) return;
        console.warn(err);
        status.value = "error";
      }
    },
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && f.focusedLandmark) {
      e.preventDefault();
      f.exitFocus();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onKeyDown);
  }
  onBeforeUnmount(() => {
    cancelPending();
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", onKeyDown);
    }
  });

  return { status, iso, reached, reveal, focusBearing, suppressBuildingFrame };
}
