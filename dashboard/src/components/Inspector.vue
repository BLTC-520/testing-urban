<!--
  The panel that appears over the map when a hexagon is clicked: what that
  patch of the city can and cannot reach, and what a scenario would change
  about it.

  The distances come from /api/cell/:h3 in metres and are converted to minutes
  here using the walking speed currently selected — the same arithmetic the
  server uses for its threshold, done on the client so the readout follows the
  speed control without a refetch.
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { cellToLatLng, latLngToCell } from "h3-js";
import { api } from "../api/client.ts";
import type { CellResponse } from "../api/types.ts";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import { metres, mins, minutesAt, people } from "../lib.ts";

const d = useData();
const f = useFilters();
const cell = ref<CellResponse | null>(null);

/**
 * A parent hexagon has no single set of distances, so the inspector shows the
 * representative resolution-10 cell the click resolved to. A synthetic
 * `unit:` selection (from the district table) has no hexagon at all.
 */
const isHex = computed(() => !!f.selection && !f.selection.hex.startsWith("unit:"));

watch(
  () => [f.selection?.hex, f.minutes, f.speed, f.scenario] as const,
  async () => {
    if (!isHex.value || !f.selection) { cell.value = null; return; }
    const hexes = d.cells?.hexes ?? [];
    const hit = hexes.find((h) => h.hex === f.selection!.hex);
    if (!hit) { cell.value = null; return; }
    const [lat, lng] = cellToLatLng(hit.hex);
    cell.value = await d.track(() =>
      api.cell(latLngToCell(lat, lng, 10), {
        city: f.city, minutes: f.minutes, speed: f.speed, scenario: f.scenario,
      }),
    );
  },
  { immediate: true },
);

const speedMps = computed(() => d.summary?.meta.speeds[f.speed] ?? 1.2);

const rows = computed(() => {
  const c = cell.value;
  if (!c) return [];
  const labels = new Map((d.summary?.essentials ?? []).map((e) => [e.id, e.label]));
  return (d.summary?.meta.basket ?? []).map((id) => {
    const before = c.cell[`d_${id}`] as number | null;
    const after = (c.scenario?.distances[`d_${id}`] ?? null) as number | null;
    return {
      id,
      label: labels.get(id) ?? id,
      before,
      after,
      reached: c.reached.includes(id),
      reachedAfter: c.scenario?.reached.includes(id) ?? null,
      gained: after !== null && before !== null && after < before - 1,
    };
  });
});

const summaryLine = computed(() => {
  const c = cell.value;
  if (!c) return null;
  const n = c.reached.length;
  const after = c.scenario?.reached.length ?? null;
  return { n, after, pop: c.cell.pop as number, unit: c.cell.unit_name as string | null };
});
</script>

<template>
  <aside class="inspector" :class="{ wide: !!cell?.scenario }">
    <header>
      <div>
        <span class="label">Selected cell</span>
        <strong>{{ summaryLine?.unit ?? f.selection?.unitName ?? "—" }}</strong>
      </div>
      <button class="close" aria-label="Clear selection" @click="f.clearSelection()">×</button>
    </header>

    <p v-if="!isHex" class="note">
      Scoped to this district from the table. Click a hexagon on the map for
      cell-level detail.
    </p>

    <template v-else-if="summaryLine">
      <p class="headline">
        <span class="num big">{{ summaryLine.n }}</span><span class="of">of 6</span>
        essentials within {{ f.minutes }} min
        <em v-if="summaryLine.after !== null && summaryLine.after !== summaryLine.n">
          → <span class="num gain">{{ summaryLine.after }}</span> with hubs
        </em>
      </p>
      <p class="note">{{ people(summaryLine.pop) }} modelled residents in this cell</p>

      <ul>
        <li v-for="r in rows" :key="r.id" :class="{ out: !r.reached, gained: r.gained }">
          <i :style="{ background: `var(--cat-${r.id})` }" />
          <span class="name">{{ r.label }}</span>
          <span class="num val">{{ mins(r.before, speedMps) }}</span>
          <span v-if="r.after !== null && r.gained" class="num after">
            → {{ mins(r.after, speedMps) }}
          </span>
          <span class="num dist">{{ metres(r.before) }}</span>
        </li>
      </ul>

      <p class="note foot">
        Walking {{ speedMps }} m/s on the mapped network.
        {{ rows.filter((r) => minutesAt(r.before, speedMps) === null).length }} beyond the
        60-minute search cap.
      </p>
    </template>
  </aside>
</template>

<style scoped>
.inspector {
  position: absolute; right: 12px; top: 54px; z-index: 6;
  width: 258px;
  background: rgba(11, 14, 18, 0.94);
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  padding: 11px 13px 10px;
  backdrop-filter: blur(6px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
}
.inspector.wide { width: 300px; }

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

.headline { margin: 8px 0 1px; font-size: 11px; color: var(--paper-1); line-height: 1.4; }
.headline .big { font-size: 22px; color: var(--paper-0); }
.headline .of { font-size: 10px; color: var(--paper-3); margin: 0 4px 0 2px; }
.headline em { font-style: normal; color: var(--paper-2); }
.headline .gain { color: var(--gain); font-size: 15px; }

.note { margin: 2px 0 0; font-size: 10px; color: var(--paper-3); line-height: 1.4; }
.foot { margin-top: 7px; border-top: 1px solid var(--line); padding-top: 6px; }

ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
li {
  display: grid;
  grid-template-columns: 9px 1fr auto auto;
  align-items: center; gap: 6px;
  padding: 2px 0;
  font-size: 11px; color: var(--paper-1);
}
li.out { color: var(--paper-3); }
li i { width: 7px; height: 7px; border-radius: 2px; }
li.out i { opacity: 0.35; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.val { font-size: 11px; }
.after { color: var(--gain); font-size: 10px; }
.dist { font-size: 9px; color: var(--paper-3); grid-column: 4; }
li.gained .val { text-decoration: line-through; color: var(--paper-3); }
</style>
