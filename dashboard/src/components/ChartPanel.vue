<!--
  Frame around a chart: title, optional note, and a sized box for the canvas.

  The sizing matters. ECharts measures its container on init and on resize; if
  the container has no definite height at that moment it renders at zero. The
  `.panel-body` here is a flex child with `min-height: 0` and the chart inside
  is `height: 100%`, which gives ECharts something real to measure.

  React equivalent: a layout component taking `title`, `note` and `children`.
-->
<script setup lang="ts">
defineProps<{ title: string; note?: string }>();
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2 class="panel-title">{{ title }}</h2>
      <span v-if="note" class="panel-note">{{ note }}</span>
      <slot name="actions" />
    </div>
    <div class="panel-body"><slot /></div>
  </section>
</template>
