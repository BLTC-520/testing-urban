<!--
  The command centre layout.

  A fixed CSS grid at 1920×1080:
    row 1  top bar                       (city, budget, speed)
    row 2  KPI column | map | charts     (3 columns)
    row 3  scenario switches

  React equivalent: the same JSX with className. `watch` with a getter is the
  one genuinely different pattern — see the comment on the watcher below.
-->
<script setup lang="ts">
import { onMounted, watch } from "vue";
import Stage from "./components/Stage.vue";
import TopBar from "./components/TopBar.vue";
import KpiColumn from "./components/KpiColumn.vue";
import ChartPanel from "./components/ChartPanel.vue";
import ThresholdCurve from "./components/ThresholdCurve.vue";
import EssentialBars from "./components/EssentialBars.vue";
import DistributionChart from "./components/DistributionChart.vue";
import DistrictTable from "./components/DistrictTable.vue";
import LandmarkList from "./components/LandmarkList.vue";
import HexMap from "./components/HexMap.vue";
import ScenarioBar from "./components/ScenarioBar.vue";
import Inspector from "./components/Inspector.vue";
import WalkFocusPanel from "./components/WalkFocusPanel.vue";
import { LANDMARKS } from "./map/landmarks.ts";
import { useData } from "./stores/data.ts";
import { useFilters } from "./stores/filters.ts";

const d = useData();
const f = useFilters();

onMounted(async () => {
  if (typeof window !== "undefined" && window.location.search) {
    f.applyUrlParams(window.location.search, LANDMARKS);
  }
  await d.loadStatic();
  await d.loadAll();
});

/*
 * Refetch when the query changes.
 *
 * React equivalent: useEffect(() => { load() }, [city, minutes, speed, scenario, unit]).
 * The difference is that the dependency list is a value here, not a list of
 * variables: `cellsQuery` is a getter, Vue tracks what it reads, and the
 * watcher fires when the resulting object differs. Nothing can be left out of a
 * dependency array by accident, which is the failure mode this replaces.
 *
 * The map and the panels are watched separately because `res` only affects the
 * map and a selection only affects the panels — watching one combined key would
 * refetch both for either change.
 */
watch(() => f.cellsQuery, () => void d.loadCells(), { deep: true });
watch(() => f.panelsQuery, () => void d.loadPanels(), { deep: true });
</script>

<template>
  <Stage>
    <div class="grid">
      <div class="area-top"><TopBar /></div>

      <div class="area-kpi"><KpiColumn /></div>

      <div class="area-map">
        <HexMap />
        <WalkFocusPanel v-if="f.focusedLandmark" />
        <Inspector v-else-if="f.selection" />
      </div>

      <div class="area-charts">
        <ChartPanel title="Complete access by walk budget" note="pipeline reference curve">
          <ThresholdCurve />
        </ChartPanel>
        <ChartPanel title="Each essential within reach" :note="`at ${f.minutes} min`">
          <EssentialBars />
        </ChartPanel>
        <ChartPanel title="Essentials reached" note="share of residents">
          <DistributionChart />
        </ChartPanel>
        <ChartPanel
          :title="f.rightTab === 'landmarks' ? 'Landmarks' : 'Districts, worst first'"
          :note="f.rightTab === 'landmarks' ? 'click to walk from' : 'click to scope'"
        >
          <template #actions>
            <div class="tab-switch" role="tablist" aria-label="Table view">
              <button
                role="tab"
                :aria-selected="f.rightTab === 'districts'"
                :class="['tab-btn', { on: f.rightTab === 'districts' }]"
                @click="f.setRightTab('districts')"
              >Districts</button>
              <button
                role="tab"
                :aria-selected="f.rightTab === 'landmarks'"
                :class="['tab-btn', { on: f.rightTab === 'landmarks' }]"
                @click="f.setRightTab('landmarks')"
              >Landmarks</button>
            </div>
          </template>
          <LandmarkList v-if="f.rightTab === 'landmarks'" />
          <DistrictTable v-else />
        </ChartPanel>
      </div>

      <div class="area-scenarios"><ScenarioBar /></div>
    </div>

    <!-- A failed fetch must say so on the screen, not only in the console. -->
    <p v-if="d.error" class="error" role="alert">{{ d.error }}</p>
    <div v-if="!d.ready" class="boot">Loading analysis…</div>
  </Stage>
</template>

<style scoped>
.grid {
  width: 100%; height: 100%;
  display: grid;
  grid-template-columns: 318px 1fr 430px;
  grid-template-rows: 86px 1fr 104px;
  grid-template-areas:
    "top   top   top"
    "kpi   map   charts"
    "scen  scen  scen";
  gap: var(--gap);
  padding: var(--gap);
}
.area-top { grid-area: top; min-width: 0; }
.area-kpi { grid-area: kpi; min-height: 0; }
.area-map { grid-area: map; min-height: 0; min-width: 0; position: relative; }
.area-charts {
  grid-area: charts;
  display: grid;
  /* Four panels, the table given more room because it has the most rows. */
  grid-template-rows: 1fr 1.08fr 1fr 1.5fr;
  gap: var(--gap);
  min-height: 0;
}
.area-charts > * { min-height: 0; }
.area-scenarios { grid-area: scen; min-width: 0; }

.tab-switch {
  display: flex; gap: 3px; margin-left: auto;
  background: var(--ink-1); border: 1px solid var(--line);
  border-radius: 5px; padding: 2px;
}
.tab-btn {
  background: transparent; border: 0; border-radius: 4px;
  padding: 2px 7px; font-size: 9px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--paper-3);
}
.tab-btn:hover { color: var(--paper-1); }
.tab-btn.on { background: var(--ink-4); color: var(--paper-0); }

.error {
  position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%);
  margin: 0; padding: 8px 14px;
  background: var(--ink-4); border: 1px solid var(--loss); border-radius: 6px;
  color: var(--paper-0); font-size: 12px;
}
.boot {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  background: var(--ink-0); color: var(--paper-3);
  font-size: 14px; letter-spacing: 0.05em;
}
</style>
