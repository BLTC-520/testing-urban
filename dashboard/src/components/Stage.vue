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
      :style="{
        width: `${STAGE_W}px`,
        height: `${STAGE_H}px`,
        transform: `translate(-50%, -50%) scale(${scale})`,
      }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.viewport {
  position: relative;
  width: 100vw; height: 100vh;
  background: var(--ink-0);
  overflow: hidden;
}
/*
  Centred by position, not by grid. A transform never changes the layout box,
  so the stage always takes up 1920×1080 for layout. Grid centring can't put a
  box wider than the viewport in the middle: the track grows to 1920px from the
  left edge and the stage ends up scaled about x=960, not the viewport centre.
  Pinning its top-left to the viewport centre and translating back by half its
  own size (-50% is of the element, so -960px, -540px) puts the stage's centre on
  the viewport's centre; the scale then shrinks it about that point.
*/
.stage {
  position: absolute;
  top: 50%; left: 50%;
  transform-origin: center center;
  /* A faint vignette so the letterbox edges read as a bezel rather than a crop. */
  box-shadow: 0 0 0 1px var(--line), 0 24px 80px rgba(0, 0, 0, 0.6);
  border-radius: 4px;
}
</style>
