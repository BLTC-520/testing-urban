<!--
  The 1920×1080 stage. Everything inside is laid out at exactly that size and
  the whole thing is scaled to fit the viewport, letterboxed to keep 16:9.

  React equivalent: the same markup with the hook's `scale` in a style object.
-->
<script setup lang="ts">
import { useStageScale, STAGE_W, STAGE_H } from "../composables/useStageScale.ts";
const { scale } = useStageScale();
</script>

<template>
  <div class="viewport">
    <div
      class="stage"
      :style="{ width: `${STAGE_W}px`, height: `${STAGE_H}px`, transform: `scale(${scale})` }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.viewport {
  width: 100vw; height: 100vh;
  display: grid; place-items: center;
  background: var(--ink-0);
  overflow: hidden;
}
.stage {
  transform-origin: center center;
  flex: 0 0 auto;
  /* A faint vignette so the letterbox edges read as a bezel rather than a crop. */
  box-shadow: 0 0 0 1px var(--line), 0 24px 80px rgba(0, 0, 0, 0.6);
  border-radius: 4px;
}
</style>
