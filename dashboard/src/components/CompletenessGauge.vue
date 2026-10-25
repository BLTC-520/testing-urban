<!--
  A 6-segment meter showing the completeness share against the ordinal ramp.

  Deliberately not an ECharts gauge: it is one number, so the dataviz heuristic
  says a meter, and a hand-built one is ~20 lines of DOM instead of a chart
  instance that has to be measured and disposed. The 2px gaps between segments
  are the spacer rule from the mark specs.
-->
<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ share: number }>();
const SEGMENTS = 10;
const filled = computed(() => Math.round(Math.min(1, Math.max(0, props.share)) * SEGMENTS));
</script>

<template>
  <div class="meter" role="img" :aria-label="`${(props.share * 100).toFixed(1)} per cent complete`">
    <span
      v-for="i in SEGMENTS" :key="i"
      :class="['seg', { on: i <= filled }]"
    />
  </div>
</template>

<style scoped>
.meter { display: flex; gap: 2px; align-items: center; height: 6px; flex: 1 1 auto; }
.seg {
  flex: 1 1 0; height: 100%; border-radius: 2px;
  background: var(--ink-4);
}
.seg.on { background: var(--ramp-5); }
</style>
