<!--
  One KPI tile: a hero number with an optional scenario delta beneath it.

  Per the dataviz form heuristic, a single headline figure is a stat tile, not
  a chart — there is no plot here and therefore no tooltip. The sparkline slot
  exists for the one tile that benefits from context.

  React equivalent: props are declared with defineProps<T>() instead of a
  function parameter; `<slot />` is `children`; the computed `tone` is useMemo.
-->
<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  label: string;
  value: string;
  /** Small print under the label — what the number is actually counting. */
  note?: string;
  /** Signed change against the baseline, already formatted. */
  delta?: string | null;
  /** Sign of the delta, for colour. Higher is not always better. */
  deltaDirection?: "up-good" | "up-bad" | null;
  deltaValue?: number | null;
  /** Accent bar colour, e.g. a city or a category token. */
  accent?: string;
  big?: boolean;
}>();

const tone = computed(() => {
  if (props.deltaValue === null || props.deltaValue === undefined || !props.deltaDirection) return "flat";
  if (Math.abs(props.deltaValue) < 1e-9) return "flat";
  const up = props.deltaValue > 0;
  const good = props.deltaDirection === "up-good" ? up : !up;
  return good ? "good" : "bad";
});
</script>

<template>
  <div class="tile panel" :style="{ '--accent': accent ?? 'var(--ramp-4)' }">
    <div class="head">
      <span class="label">{{ label }}</span>
      <span v-if="note" class="note">{{ note }}</span>
    </div>
    <div class="value num" :class="{ big }">{{ value }}</div>
    <div class="foot">
      <span v-if="delta" class="delta num" :class="tone">{{ delta }}</span>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.tile {
  padding: 11px 13px 9px;
  gap: 2px;
  position: relative;
  overflow: hidden;
}
/* The accent is a 3px rail, not a tinted background: a filled tile would put a
   large block of series colour behind text, which the palette is not validated
   for. */
.tile::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 3px;
  background: var(--accent); opacity: 0.85;
}
.head { display: flex; flex-direction: column; gap: 1px; }
.label {
  font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--paper-2);
}
.note { font-size: 10px; color: var(--paper-3); line-height: 1.25; }
.value {
  font-size: 31px; line-height: 1.05; color: var(--paper-0);
  margin-top: auto; letter-spacing: -0.01em;
}
.value.big { font-size: 42px; }
.foot { display: flex; align-items: center; gap: 8px; min-height: 15px; }
.delta { font-size: 12px; }
.delta.good { color: var(--ramp-5); }
.delta.bad { color: var(--loss); }
.delta.flat { color: var(--paper-3); }
</style>
