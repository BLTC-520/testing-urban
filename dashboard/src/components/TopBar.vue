<!--
  Top bar: city toggle, walk budget, walking speed, and the data vintage.

  React equivalent of the patterns here:
    <script setup>            the body of a function component
    const f = useFilters()    a Zustand/Context hook; `f` stays stable, its
                              fields are reactive, so no dependency arrays
    computed(() => …)         useMemo
    @click / :class           onClick / className
    v-for + :key              .map() + key
  Props/emits are not used: the store is the interface, exactly as a React
  component would read a Zustand store rather than take 20 props.
-->
<script setup lang="ts">
import { computed } from "vue";
import { useFilters } from "../stores/filters.ts";
import { useData } from "../stores/data.ts";
import type { CityId, SpeedId } from "../api/types.ts";

const f = useFilters();
const d = useData();

/** Singapore first, to match the title and the default selection. */
const CITY_ORDER: CityId[] = ["sg", "jb"];
const cities = computed(() =>
  [...(d.summary?.cities ?? [])].sort((a, b) => CITY_ORDER.indexOf(a.id) - CITY_ORDER.indexOf(b.id)),
);

/** Slowest to fastest, rather than whatever order the JSON happened to carry. */
const SPEED_ORDER: SpeedId[] = ["slow", "base", "brisk"];
const speeds = computed(() =>
  (Object.entries(d.summary?.meta.speeds ?? {}) as [SpeedId, number][])
    .sort((a, b) => SPEED_ORDER.indexOf(a[0]) - SPEED_ORDER.indexOf(b[0])),
);
const thresholds = computed(() => d.summary?.meta.thresholds ?? [5, 10, 15, 20]);

const speedLabel: Record<string, string> = {
  slow: "Slow", base: "Average", brisk: "Brisk",
};

/** The pipeline's OSM snapshot, not "now": the screen must not imply live data. */
const vintage = computed(() => d.summary?.meta.osm_snapshot ?? "");
</script>

<template>
  <header class="bar panel">
    <div class="brand">
      <h1>SG&nbsp;/&nbsp;JB Command Centre</h1>
      <p>15-minute access to everyday essentials</p>
    </div>

    <div class="group" role="group" aria-label="City">
      <span class="label">City</span>
      <div class="seg">
        <button
          v-for="c in cities" :key="c.id"
          :class="['seg-btn', { on: f.city === c.id }]"
          :style="{ '--accent': `var(--${c.id})` }"
          :aria-pressed="f.city === c.id"
          @click="f.setCity(c.id as CityId)"
        >{{ c.name }}</button>
      </div>
    </div>

    <div class="group grow" role="group" aria-label="Walk budget">
      <span class="label">Walk budget</span>
      <div class="slider-row">
        <input
          type="range" min="1" max="30" step="1"
          :value="f.minutes"
          aria-label="Walking minutes"
          @input="f.setMinutes(+($event.target as HTMLInputElement).value)"
        />
        <output class="num readout">{{ f.minutes }}<span class="unit">min</span></output>
      </div>
      <div class="presets">
        <button
          v-for="t in thresholds" :key="t"
          :class="['chip', { on: f.minutes === t }]"
          @click="f.setMinutes(t)"
        >{{ t }}</button>
      </div>
    </div>

    <div class="group" role="group" aria-label="Walking speed">
      <span class="label">Walking speed</span>
      <div class="seg">
        <button
          v-for="[id, mps] in speeds" :key="id"
          :class="['seg-btn', { on: f.speed === id }]"
          :aria-pressed="f.speed === id"
          @click="f.setSpeed(id)"
        >
          {{ speedLabel[id] ?? id }}
          <small class="num">{{ mps }}</small>
        </button>
      </div>
    </div>

    <div class="vintage">
      <span class="label">OSM snapshot</span>
      <span class="num">{{ vintage }}</span>
      <span :class="['dot', { busy: d.busy }]" :title="d.busy ? 'loading' : 'idle'" />
    </div>
  </header>
</template>

<style scoped>
.bar {
  flex-direction: row;
  align-items: stretch;
  gap: 28px;
  padding: 0 18px;
  height: 100%;
}
.brand { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding-right: 8px; }
.brand h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 25px;
  font-weight: 400;
  letter-spacing: 0.01em;
  color: var(--paper-0);
}
.brand p { margin: 0; font-size: 11px; color: var(--paper-3); }

.group { display: flex; flex-direction: column; justify-content: center; gap: 5px; }
.grow { flex: 1 1 auto; max-width: 420px; }
.label {
  font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--paper-3);
}

.seg { display: flex; gap: 3px; background: var(--ink-1); border: 1px solid var(--line); border-radius: 7px; padding: 3px; }
.seg-btn {
  display: flex; align-items: baseline; gap: 5px;
  background: transparent; border: 0; border-radius: 5px;
  padding: 5px 11px; font-size: 13px; color: var(--paper-2);
  transition: background 120ms, color 120ms;
}
.seg-btn small { font-size: 9px; color: var(--paper-3); }
.seg-btn:hover { background: var(--ink-3); color: var(--paper-1); }
.seg-btn.on {
  background: var(--ink-4);
  color: var(--paper-0);
  /* City identity is carried by a bar, not by the text colour: text stays in
     an ink token so the two cities' labels remain equally legible. */
  box-shadow: inset 0 -2px 0 0 var(--accent, var(--ramp-4));
}
.seg-btn.on small { color: var(--paper-2); }

.slider-row { display: flex; align-items: center; gap: 10px; }
input[type="range"] {
  flex: 1 1 auto; appearance: none; height: 4px; border-radius: 2px;
  background: linear-gradient(90deg, var(--ramp-2), var(--ramp-5));
  outline-offset: 4px;
}
input[type="range"]::-webkit-slider-thumb {
  appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: var(--paper-0); border: 2px solid var(--ink-1); cursor: grab;
}
input[type="range"]::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--paper-0); border: 2px solid var(--ink-1); cursor: grab;
}
.readout { font-size: 19px; color: var(--paper-0); min-width: 58px; text-align: right; }
.readout .unit { font-size: 10px; color: var(--paper-3); margin-left: 3px; }

.presets { display: flex; gap: 4px; }
.chip {
  background: var(--ink-1); border: 1px solid var(--line); border-radius: 4px;
  padding: 1px 7px; font-size: 10px; color: var(--paper-3);
  font-family: var(--font-mono);
}
.chip:hover { color: var(--paper-1); }
.chip.on { background: var(--ink-4); color: var(--paper-0); border-color: var(--line-strong); }

.vintage {
  display: flex; flex-direction: column; justify-content: center; gap: 3px;
  margin-left: auto; text-align: right; font-size: 11px; color: var(--paper-2);
  position: relative; padding-right: 14px;
}
.dot {
  position: absolute; top: 50%; right: 0; transform: translateY(-50%);
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--ramp-5); opacity: 0.35; transition: opacity 150ms;
}
.dot.busy { opacity: 1; animation: pulse 900ms ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
</style>
