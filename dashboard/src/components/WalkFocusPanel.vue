<!--
  Walk-focus info panel, shown in the same map overlay slot as Inspector.vue
  when a landmark is focused.

  Displays:
    · landmark name and snapped street-graph start point
    · farthest walking distance reached within the budget (metres and minutes)
    · per essential category: nearest place's name and minutes, plus count
      within the walk budget
    · explicit status messages when off-network or when tiles fail to load
-->
<script setup lang="ts">
import { computed } from "vue";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import { useWalkFocusState } from "../composables/useWalkFocus.ts";
import { int, titleise } from "../lib.ts";

const d = useData();
const f = useFilters();
const { status, iso, reached } = useWalkFocusState();

const speedMps = computed(() => d.summary?.meta.speeds[f.speed] ?? 1.2);

const startText = computed(() => {
  const curIso = iso.value;
  if (curIso) {
    const [lon, lat] = curIso.startNode;
    return `Start node ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E (${Math.round(curIso.snapM)} m snap)`;
  }
  const lm = f.focusedLandmark;
  if (!lm) return "";
  return `Building ${lm.position[1].toFixed(4)}°N, ${lm.position[0].toFixed(4)}°E`;
});

const farthest = computed(() => {
  const curIso = iso.value;
  if (!curIso) return null;
  const distM = Math.round(curIso.maxDistanceM);
  const mins = curIso.maxDistanceM / speedMps.value / 60;
  return {
    metres: `${int(distM)} m`,
    minutes: `${mins.toFixed(1)} min`,
  };
});

const categoryRows = computed(() => {
  const r = reached.value;
  if (!r) return [];
  const labels = new Map((d.summary?.essentials ?? []).map((e) => [e.id, e.label]));
  const basket = d.summary?.meta.basket ?? [
    "groceries", "healthcare", "education", "green_space", "transit", "dining",
  ];
  return basket.map((id) => {
    const near = r.nearest[id] ?? null;
    const within = near !== null && near.minutes <= f.minutes;
    const count = r.counts[id] ?? 0;
    return {
      id,
      label: labels.get(id) ?? titleise(id),
      nearestName: within ? (near.name || `Unnamed ${titleise(id).toLowerCase()}`) : "None within budget",
      minutesText: within ? `${near.minutes.toFixed(1)} min` : `> ${f.minutes} min`,
      count,
      within,
    };
  });
});

const reachedCount = computed(() => categoryRows.value.filter((r) => r.within).length);

function toggleCategoryRoute(id: string, within: boolean) {
  if (!within) return;
  f.setActiveRouteCategory(f.activeRouteCategory === id ? null : id);
}
</script>

<template>
  <aside v-if="f.focusedLandmark" class="inspector focus-panel" aria-label="Landmark walk focus">
    <header>
      <div>
        <span class="label">{{ f.focusedLandmark.kind }} · walk focus</span>
        <strong>{{ f.focusedLandmark.name }}</strong>
      </div>
      <button class="close" aria-label="Exit landmark focus" @click="f.exitFocus()">×</button>
    </header>

    <p class="start num">{{ startText }}</p>

    <p v-if="status === 'loading'" class="state">
      Walking the street network from {{ f.focusedLandmark.name }}…
    </p>

    <p v-else-if="status === 'offnetwork'" class="state warn" role="status">
      Off the street network: this landmark is more than 400 m from any mapped walkable street.
    </p>

    <p v-else-if="status === 'error'" class="state warn" role="alert">
      Could not load street-graph tiles or POI data for this area.
    </p>

    <template v-else-if="status === 'ready' && farthest">
      <div class="metrics">
        <p class="headline">
          <span class="num big">{{ reachedCount }}</span><span class="of">of 6</span>
          essentials within {{ f.minutes }} min
        </p>
        <p class="reach num">
          Farthest walk reached: <b>{{ farthest.metres }}</b> ({{ farthest.minutes }})
        </p>
      </div>

      <ul class="cat-list">
        <li
          v-for="r in categoryRows"
          :key="r.id"
          :class="{ out: !r.within, active: f.activeRouteCategory === r.id }"
          :role="r.within ? 'button' : undefined"
          :tabindex="r.within ? 0 : undefined"
          @mouseenter="r.within && f.setActiveRouteCategory(r.id)"
          @mouseleave="r.within && f.activeRouteCategory === r.id && f.setActiveRouteCategory(null)"
          @click="toggleCategoryRoute(r.id, r.within)"
          @keydown.enter="toggleCategoryRoute(r.id, r.within)"
        >
          <i :style="{ background: `var(--cat-${r.id})` }" />
          <div class="cat-main">
            <span class="cat-label">{{ r.label }}</span>
            <span class="nearest-name">{{ r.nearestName }}</span>
          </div>
          <span class="num mins">{{ r.minutesText }}</span>
          <span class="num count" :title="`${r.count} within ${f.minutes} min`">{{ int(r.count) }}</span>
        </li>
      </ul>

      <p class="note foot">
        Walking {{ speedMps }} m/s · hover or click a category or 3D beacon to trace its shortest route · Esc to exit
      </p>
    </template>
  </aside>
</template>

<style scoped>
.inspector {
  position: absolute; right: 12px; top: 54px; z-index: 6;
  width: 304px;
  background: rgba(11, 14, 18, 0.94);
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  padding: 11px 13px 10px;
  backdrop-filter: blur(6px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
}

header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.label {
  display: block; font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--paper-3);
}
header strong { font-size: 13px; color: var(--paper-0); }
.close {
  background: none; border: 0; padding: 0 2px; line-height: 1;
  font-size: 18px; color: var(--paper-3);
}
.close:hover { color: var(--paper-0); }

.start {
  margin: 4px 0 0; font-size: 9px; color: var(--paper-3);
}

.state {
  margin: 10px 0 4px; padding: 7px 9px; border-radius: 6px;
  background: var(--ink-3); border: 1px solid var(--line);
  font-size: 11px; line-height: 1.45; color: var(--paper-1);
}
.state.warn { border-color: var(--warn); color: var(--paper-0); }

.metrics { margin: 7px 0 0; }
.headline { margin: 0; font-size: 11px; color: var(--paper-1); line-height: 1.35; }
.headline .big { font-size: 21px; color: var(--paper-0); }
.headline .of { font-size: 10px; color: var(--paper-3); margin: 0 4px 0 2px; }
.reach { margin: 3px 0 0; font-size: 10px; color: var(--paper-2); }
.reach b { color: var(--ramp-5); }

.cat-list {
  list-style: none; margin: 8px 0 0; padding: 0;
  display: flex; flex-direction: column; gap: 4px;
}
.cat-list li {
  display: grid;
  grid-template-columns: 9px 1fr auto 36px;
  align-items: center; gap: 6px;
  padding: 3px 5px;
  margin: 0 -5px;
  border-radius: 5px;
  border: 1px solid transparent;
  font-size: 11px; color: var(--paper-1);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.cat-list li:hover:not(.out),
.cat-list li.active {
  background: var(--ink-3);
  border-color: var(--line-strong);
}
.cat-list li.out { color: var(--paper-3); cursor: default; }
.cat-list li i { width: 7px; height: 7px; border-radius: 50%; }
.cat-list li.out i { opacity: 0.35; }
.cat-main { display: flex; flex-direction: column; min-width: 0; }
.cat-label { font-size: 10px; font-weight: 600; color: var(--paper-0); line-height: 1.2; }
.cat-list li.out .cat-label { color: var(--paper-3); }
.nearest-name {
  font-size: 9px; color: var(--paper-2); line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mins { font-size: 10px; color: var(--paper-1); text-align: right; }
.count {
  font-size: 9px; color: var(--paper-2); text-align: right;
  background: var(--ink-3); border: 1px solid var(--line);
  border-radius: 4px; padding: 1px 4px;
}

.note { margin: 2px 0 0; font-size: 9px; color: var(--paper-3); line-height: 1.4; }
.foot { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 6px; }
</style>
