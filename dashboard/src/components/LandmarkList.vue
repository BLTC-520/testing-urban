<!--
  Landmarks for the active city, sortable by rank, name or kind.

  Clicking a row triggers the same store action as clicking a callout on the
  map: the camera flies to the building, then grows the walk-shed routes
  outward from its nearest street-graph node.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import { listLandmarks, type Landmark, type LandmarkSort } from "../map/landmarks.ts";

const d = useData();
const f = useFilters();

const sortBy = ref<LandmarkSort>("importance");

const cityName = computed(
  () => d.summary?.cities.find((c) => c.id === f.city)?.name ?? (f.city === "sg" ? "Singapore" : "Johor Bahru"),
);

const rows = computed(() => listLandmarks(f.city, sortBy.value));
const activeId = computed(() => f.focusedLandmark?.id ?? null);

function pick(l: Landmark) {
  if (f.focusedLandmark?.id === l.id) {
    f.exitFocus();
  } else {
    f.focusLandmark(l);
  }
}
</script>

<template>
  <div class="wrap">
    <div class="bar">
      <span class="group-label">{{ cityName }} · {{ rows.length }} landmarks</span>
      <div class="sort" role="group" aria-label="Sort landmarks">
        <button
          v-for="opt in ([
            ['importance', 'Rank'],
            ['name', 'Name'],
            ['kind', 'Kind'],
          ] as const)"
          :key="opt[0]"
          :class="['chip', { on: sortBy === opt[0] }]"
          @click="sortBy = opt[0]"
        >{{ opt[1] }}</button>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="l" @click="sortBy = 'name'">Landmark</th>
          <th class="r" @click="sortBy = 'kind'">Kind</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="l in rows" :key="l.id"
          :class="{ on: activeId === l.id }"
          tabindex="0"
          :data-landmark-id="l.id"
          @click="pick(l)"
          @keydown.enter="pick(l)"
        >
          <td class="l">
            <span class="name">{{ l.name }}</span>
          </td>
          <td class="r">
            <span class="badge">{{ l.kind }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.bar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 0 4px 5px;
}
.group-label {
  font-size: 9px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--paper-3);
}
.sort { display: flex; gap: 3px; }
.chip {
  background: var(--ink-1); border: 1px solid var(--line); border-radius: 4px;
  padding: 1px 6px; font-size: 9px; color: var(--paper-3);
  font-family: var(--font-mono);
}
.chip:hover { color: var(--paper-1); }
.chip.on { background: var(--ink-4); color: var(--paper-0); border-color: var(--line-strong); }

table { width: 100%; border-collapse: collapse; font-size: 11px; }
thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--ink-2);
  padding: 2px 6px 5px;
  font-size: 9px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--paper-3);
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
tbody { display: block; overflow-y: auto; overflow-x: hidden; max-height: 196px; }
thead, tbody tr { display: table; width: 100%; table-layout: fixed; }
tbody::-webkit-scrollbar { width: 6px; }
tbody::-webkit-scrollbar-thumb { background: var(--ink-4); border-radius: 3px; }

tbody tr { border-bottom: 1px solid rgba(236, 233, 226, 0.045); cursor: pointer; }
tbody tr:hover { background: var(--ink-3); }
tbody tr.on { background: var(--ink-4); }
tbody tr.on .name { color: var(--paper-0); font-weight: 600; }
td { padding: 3px 6px; color: var(--paper-1); }
.l { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r { text-align: right; width: 88px; }
.badge {
  display: inline-block; padding: 1px 5px; border-radius: 3px;
  background: var(--ink-1); border: 1px solid var(--line);
  font-size: 8px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--paper-3);
}
</style>
