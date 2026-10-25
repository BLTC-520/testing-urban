<!--
  Districts ranked by complete access, worst first.

  Form: this is identity plus one magnitude across ~55 rows. A bar chart with 55
  category labels is unreadable on a wall; a table with an inline bar per row is
  the right form, and it doubles as the "a table view exists" accessibility
  requirement for the charts beside it.

  Clicking a row scopes the whole left column and the other panels to that
  district, which is the same action the map's hex click performs.
-->
<script setup lang="ts">
import { computed } from "vue";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import { people, pct } from "../lib.ts";

const d = useData();
const f = useFilters();

const rows = computed(() => {
  const list = d.panels?.by_unit ?? [];
  const before = d.baselinePanels?.by_unit ?? [];
  return [...list]
    .sort((a, b) => a.share_complete - b.share_complete)
    .map((u) => ({
      ...u,
      baseline: before.find((x) => x.unit_idx === u.unit_idx)?.share_complete ?? null,
    }));
});

const selected = computed(() => f.selection?.unit ?? null);

function pick(unitIdx: number, unitName: string) {
  // Reuse the map's selection channel so the two stay in step. A table row has
  // no hexagon, so the hex key is synthetic.
  f.select({ hex: `unit:${unitIdx}`, unit: unitIdx, unitName });
}
</script>

<template>
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th class="l">District</th>
          <th class="r">Residents</th>
          <th class="bar">Complete access</th>
          <th class="r">Share</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="u in rows" :key="u.unit_idx"
          :class="{ on: selected === u.unit_idx }"
          tabindex="0"
          @click="pick(u.unit_idx, u.unit_name)"
          @keydown.enter="pick(u.unit_idx, u.unit_name)"
        >
          <td class="l">{{ u.unit_name }}</td>
          <td class="r num">{{ people(u.pop) }}</td>
          <td class="bar">
            <span class="track">
              <span class="fill" :style="{ width: `${Math.max(u.share_complete * 100, 0.6)}%` }" />
              <!-- Baseline tick: where this district sat before the scenario. -->
              <span
                v-if="u.baseline !== null"
                class="tick"
                :style="{ left: `${u.baseline * 100}%` }"
                :title="`baseline ${pct(u.baseline)}`"
              />
            </span>
          </td>
          <td class="r num">{{ pct(u.share_complete, 0) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.wrap { height: 100%; overflow-y: auto; overflow-x: hidden; }
/* A wall display has no cursor, but the panel is scrollable for desk review. */
.wrap::-webkit-scrollbar { width: 6px; }
.wrap::-webkit-scrollbar-thumb { background: var(--ink-4); border-radius: 3px; }

table { width: 100%; border-collapse: collapse; font-size: 11px; }
thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--ink-2);
  padding: 2px 6px 5px;
  font-size: 9px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--paper-3);
  border-bottom: 1px solid var(--line);
}
tbody tr { border-bottom: 1px solid rgba(236, 233, 226, 0.045); }
tbody tr:hover { background: var(--ink-3); }
tbody tr.on { background: var(--ink-4); }
tbody tr.on .l { color: var(--paper-0); }
td { padding: 3px 6px; color: var(--paper-1); }
.l { text-align: left; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r { text-align: right; width: 58px; color: var(--paper-2); }
.bar { width: auto; }
.track {
  position: relative; display: block; height: 7px; border-radius: 3px;
  background: var(--ink-4); overflow: visible;
}
.fill {
  position: absolute; inset: 0 auto 0 0; height: 100%;
  border-radius: 3px; background: var(--ramp-4);
}
.tick {
  position: absolute; top: -2px; width: 1px; height: 11px;
  background: var(--paper-2);
}
</style>
