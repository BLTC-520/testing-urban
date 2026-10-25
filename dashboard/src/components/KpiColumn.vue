<!--
  The left column of KPI tiles.

  Every number here comes from /api/panels, which applies the same filters as
  the map — so the tiles and the map can never disagree. When a scenario is
  active the deltas are against the baseline panels fetched alongside it.
-->
<script setup lang="ts">
import { computed } from "vue";
import KpiTile from "./KpiTile.vue";
import CompletenessGauge from "./CompletenessGauge.vue";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import { people, pct, pp } from "../lib.ts";

const d = useData();
const f = useFilters();

const t = computed(() => d.panels?.totals ?? null);
const b = computed(() => d.baselinePanels?.totals ?? null);

/** Delta in a metric against the baseline, or null when no scenario is on. */
const delta = (key: "share_complete" | "share_low_access" | "mean_categories" | "low_access_population") =>
  computed(() => (t.value && b.value ? t.value[key] - b.value[key] : null));

const dComplete = delta("share_complete");
const dLow = delta("share_low_access");
const dMean = delta("mean_categories");
const dLowPop = delta("low_access_population");

const accent = computed(() => `var(--${f.city})`);

/** Whether the figures describe one district or the whole city. */
const scope = computed(() =>
  f.selection?.unitName ? f.selection.unitName : (d.summary?.cities.find((c) => c.id === f.city)?.name ?? ""),
);

const weakest = computed(() => {
  const list = d.panels?.by_essential ?? [];
  if (!list.length) return null;
  const w = [...list].sort((a, c) => a.share_within - c.share_within)[0];
  const label = d.summary?.essentials.find((e) => e.id === w.id)?.label ?? w.id;
  return { label, share: w.share_within, id: w.id };
});
</script>

<template>
  <div class="col">
    <div class="scope">
      <span class="label">Showing</span>
      <strong>{{ scope }}</strong>
      <button v-if="f.selection" class="clear" @click="f.clearSelection()">clear</button>
    </div>

    <KpiTile
      label="Complete 15-min access"
      :note="`All ${d.summary?.meta.basket.length ?? 6} essentials within ${f.minutes} min`"
      :value="pct(t?.share_complete)"
      :delta="dComplete !== null ? pp(dComplete) : null"
      :delta-value="dComplete"
      delta-direction="up-good"
      :accent="accent"
      big
    >
      <CompletenessGauge :share="t?.share_complete ?? 0" />
    </KpiTile>

    <KpiTile
      label="Low access"
      note="Fewer than half the basket reachable"
      :value="pct(t?.share_low_access)"
      :delta="dLow !== null ? pp(dLow) : null"
      :delta-value="dLow"
      delta-direction="up-bad"
      accent="var(--loss)"
    />

    <KpiTile
      label="Residents underserved"
      note="People in low-access cells"
      :value="people(t?.low_access_population)"
      :delta="dLowPop !== null ? `${dLowPop >= 0 ? '+' : '−'}${people(Math.abs(dLowPop))}` : null"
      :delta-value="dLowPop"
      delta-direction="up-bad"
      accent="var(--warn)"
    />

    <KpiTile
      label="Essentials reached"
      note="Population-weighted mean, of 6"
      :value="t ? t.mean_categories.toFixed(2) : '—'"
      :delta="dMean !== null ? `${dMean >= 0 ? '+' : '−'}${Math.abs(dMean).toFixed(2)}` : null"
      :delta-value="dMean"
      delta-direction="up-good"
      accent="var(--ramp-4)"
    />

    <KpiTile
      v-if="weakest"
      label="Scarcest essential"
      note="Lowest share within reach"
      :value="weakest.label"
      :accent="`var(--cat-${weakest.id})`"
    >
      <span class="num small">{{ pct(weakest.share) }} within reach</span>
    </KpiTile>

    <KpiTile
      label="Population on network"
      note="Residents in cells with a measured walk"
      :value="people(t?.population_on_network)"
      :accent="'var(--paper-3)'"
    />
  </div>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--gap); height: 100%; }
.col > :deep(.tile) { flex: 1 1 0; }
.scope {
  display: flex; align-items: baseline; gap: 7px;
  padding: 0 2px;
}
.scope .label {
  font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--paper-3);
}
.scope strong { font-size: 13px; color: var(--paper-0); font-weight: 600; }
.clear {
  margin-left: auto; background: none; border: 0; padding: 0;
  font-size: 10px; color: var(--ramp-4); text-decoration: underline;
}
.small { font-size: 11px; color: var(--paper-3); }
</style>
