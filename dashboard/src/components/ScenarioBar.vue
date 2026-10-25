<!--
  Bottom bar: the Parking to Proximity scenario switches.

  The scenario asks: if shared autonomous vehicles cut the need for car parking,
  and the best N car parks near under-served homes became neighbourhood service
  hubs, how much would 15-minute completeness change? The pipeline evaluated
  N = 10, 25 and 50 with the same accessibility engine as the observed baseline.

  Switching one on changes every panel at once: the map recolours, the KPI tiles
  grow deltas, and the two bar charts gain a baseline outline. That works
  because every panel reads /api/panels and /api/cells with the same `scenario`
  parameter from the one store — nothing here reaches into another component.

  Each switch shows the pipeline's own published delta, not one this dashboard
  derived, so the figures agree with the study.
-->
<script setup lang="ts">
import { computed } from "vue";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import { people, pct, pp } from "../lib.ts";

const d = useData();
const f = useFilters();

const runs = computed(() => d.cityScenarios);
const active = computed(() => d.activeScenario);

/** Live delta under the current filters, which may not be the published 15-min one. */
const liveDelta = computed(() => {
  const now = d.panels?.totals.share_complete;
  const before = d.baselinePanels?.totals.share_complete;
  return now !== undefined && before !== undefined ? now - before : null;
});

/** Widest published delta in this city, so the bars share a scale. */
const scale = computed(() =>
  Math.max(0.01, ...runs.value.map((r) => Math.abs(r.delta_share_complete))),
);

const atHeadline = computed(() => f.minutes === (d.summary?.meta.headline_threshold_min ?? 15));
</script>

<template>
  <section class="panel bar">
    <div class="intro">
      <h2 class="panel-title">Scenario · Parking to Proximity</h2>
      <p>
        Convert the car parks that would help most into neighbourhood service hubs.
        <span class="dim">Published deltas are at 15 min, 1.2 m/s.</span>
      </p>
    </div>

    <div class="switches" role="group" aria-label="Scenario">
      <button
        :class="['sw', { on: !f.isScenario }]"
        :aria-pressed="!f.isScenario"
        @click="f.setScenario(null)"
      >
        <span class="sw-label">Observed</span>
        <span class="sw-value num">{{ pct(runs[0]?.share_complete_before) }}</span>
        <span class="sw-note">today</span>
      </button>

      <button
        v-for="r in runs" :key="r.id"
        :class="['sw', { on: f.scenario === r.id }]"
        :aria-pressed="f.scenario === r.id"
        @click="f.setScenario(r.id)"
      >
        <span class="sw-label">{{ r.sites }} sites</span>
        <span class="sw-value num">{{ pct(r.share_complete_after) }}</span>
        <span class="sw-delta num">{{ pp(r.delta_share_complete) }}</span>
        <!-- A proportional bar beneath each switch: the deltas are the point,
             and three numbers alone do not show that the returns diminish. -->
        <span class="sw-bar">
          <i :style="{ width: `${(r.delta_share_complete / scale) * 100}%` }" />
        </span>
        <span class="sw-note">{{ people(r.newly_complete) }} newly complete</span>
      </button>
    </div>

    <div v-if="active" class="detail">
      <button
        :class="['toggle', { on: f.showDelta }]"
        :aria-pressed="f.showDelta"
        @click="f.toggleDelta()"
      >
        <span class="dot" />
        Map shows {{ f.showDelta ? "change" : "level" }}
      </button>

      <dl>
        <div>
          <dt>Converted land</dt>
          <dd class="num">{{ active.site_area_ha?.toFixed(1) ?? "—" }} ha</dd>
        </div>
        <div>
          <dt>Low access</dt>
          <dd class="num">
            {{ pct(active.share_low_before) }} → {{ pct(active.share_low_after) }}
          </dd>
        </div>
        <div>
          <dt>Underserved residents</dt>
          <dd class="num">
            {{ people(active.low_access_pop_before) }} → {{ people(active.low_access_pop_after) }}
          </dd>
        </div>
        <div v-if="liveDelta !== null">
          <dt>At {{ f.minutes }} min, {{ f.speed }}</dt>
          <dd class="num" :class="{ hi: !atHeadline }">{{ pp(liveDelta) }}</dd>
        </div>
      </dl>

      <p class="caveat">
        A transparent what-if, not a prediction: hub sites are chosen greedily to
        maximise newly-complete population, and nobody moves.
      </p>
    </div>

    <p v-else class="caveat idle">
      Pick a scenario to compare it against today. The map, the tiles and the
      charts all switch together.
    </p>
  </section>
</template>

<style scoped>
.bar {
  flex-direction: row;
  align-items: stretch;
  gap: 20px;
  padding: 9px 16px;
  height: 100%;
}
.intro { display: flex; flex-direction: column; justify-content: center; gap: 3px; width: 236px; flex: 0 0 auto; }
.intro p { margin: 0; font-size: 10px; line-height: 1.4; color: var(--paper-2); }
.dim { color: var(--paper-3); }

.switches { display: flex; gap: 8px; flex: 0 0 auto; }
.sw {
  display: grid;
  grid-template-rows: auto auto auto auto;
  align-content: center;
  gap: 2px;
  min-width: 112px;
  background: var(--ink-1);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 7px 10px;
  text-align: left;
  transition: border-color 120ms, background 120ms;
}
.sw:hover { border-color: var(--line-strong); background: var(--ink-3); }
.sw.on {
  background: var(--ink-4);
  border-color: var(--ramp-4);
  box-shadow: inset 0 0 0 1px var(--ramp-4);
}
.sw-label {
  font-size: 9px; font-weight: 600; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--paper-3);
}
.sw.on .sw-label { color: var(--paper-1); }
.sw-value { font-size: 19px; color: var(--paper-0); line-height: 1.1; }
.sw-delta { font-size: 11px; color: var(--gain); }
.sw-bar {
  display: block; height: 3px; border-radius: 2px;
  background: var(--ink-4); margin: 2px 0 1px; overflow: hidden;
}
.sw-bar i { display: block; height: 100%; background: var(--gain); border-radius: 2px; }
.sw-note { font-size: 9px; color: var(--paper-3); }

.detail { display: flex; align-items: center; gap: 18px; flex: 1 1 auto; min-width: 0; }
.toggle {
  display: flex; align-items: center; gap: 6px;
  background: var(--ink-1); border: 1px solid var(--line);
  border-radius: 6px; padding: 5px 10px;
  font-size: 11px; color: var(--paper-2); white-space: nowrap;
}
.toggle.on { color: var(--paper-0); border-color: var(--line-strong); background: var(--ink-4); }
.toggle .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--ink-4); border: 1px solid var(--line-strong);
}
.toggle.on .dot { background: var(--gain); border-color: var(--gain); }

dl { display: flex; gap: 20px; margin: 0; flex: 1 1 auto; min-width: 0; }
dl > div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
dt {
  font-size: 9px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--paper-3); white-space: nowrap;
}
dd { margin: 0; font-size: 12px; color: var(--paper-1); white-space: nowrap; }
dd.hi { color: var(--gain); }

.caveat {
  margin: 0; font-size: 9px; line-height: 1.4; color: var(--paper-3);
  max-width: 210px; flex: 0 0 auto;
}
.caveat.idle {
  display: flex; align-items: center; max-width: none;
  flex: 1 1 auto; font-size: 11px;
}
</style>
