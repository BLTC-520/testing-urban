<!--
  Floating curated-landmarks pill bar on the map canvas.

  Always one click away whether viewing the whole city or already inside a
  landmark walk-focus shot: clicking any pill flies directly to that building
  and spreads out its walking routes; clicking the active pill exits focus;
  ‹ and › step through the city's famous locations in order.
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useFilters } from "../stores/filters.ts";
import { CURATED, type Landmark } from "../map/landmarks.ts";

const f = useFilters();
const strip = ref<HTMLDivElement | null>(null);

const famous = computed<Landmark[]>(() => {
  const base = CURATED.filter((l) => l.city === f.city);
  const cur = f.focusedLandmark;
  if (cur && cur.city === f.city && !base.some((l) => l.id === cur.id)) {
    return [cur, ...base];
  }
  return base;
});

const activeIndex = computed(() => {
  const id = f.focusedLandmark?.id;
  return id ? famous.value.findIndex((l) => l.id === id) : -1;
});

function pick(l: Landmark) {
  if (f.focusedLandmark?.id === l.id) {
    f.exitFocus();
  } else {
    f.focusLandmark(l);
  }
}

function step(delta: -1 | 1) {
  const list = famous.value;
  if (list.length === 0) return;
  const idx = activeIndex.value;
  const next =
    idx < 0
      ? delta > 0 ? 0 : list.length - 1
      : (idx + delta + list.length) % list.length;
  f.focusLandmark(list[next]);
}

watch(
  () => f.focusedLandmark?.id,
  async (id) => {
    if (!id) return;
    await nextTick();
    const el = strip.value?.querySelector<HTMLElement>(`[data-famous-id="${id}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  },
);
</script>

<template>
  <nav class="famous-bar" aria-label="Famous locations">
    <span class="tag">Famous</span>

    <div class="nav-arrows">
      <button
        type="button"
        class="step-btn"
        title="Previous landmark"
        aria-label="Previous landmark"
        @click="step(-1)"
      >‹</button>
      <button
        type="button"
        class="step-btn"
        title="Next landmark"
        aria-label="Next landmark"
        @click="step(1)"
      >›</button>
    </div>

    <div ref="strip" class="pills">
      <button
        v-for="l in famous"
        :key="l.id"
        type="button"
        :data-famous-id="l.id"
        :class="['pill', { on: f.focusedLandmark?.id === l.id }]"
        :aria-pressed="f.focusedLandmark?.id === l.id"
        :title="`${l.name} (${l.kind}) — ${l.note}`"
        @click="pick(l)"
      >
        <span class="dot" />
        <span class="name">{{ l.name }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.famous-bar {
  position: absolute;
  left: 12px;
  right: 226px;
  top: 10px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(7, 9, 12, 0.86);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 4px 7px;
  backdrop-filter: blur(6px);
  min-width: 0;
}

.tag {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--paper-3);
  padding: 0 2px;
  flex-shrink: 0;
}

.nav-arrows {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.step-btn {
  background: var(--ink-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  width: 18px;
  height: 20px;
  padding: 0;
  line-height: 1;
  font-size: 13px;
  color: var(--paper-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.step-btn:hover {
  color: var(--paper-0);
  border-color: var(--line-strong);
  background: var(--ink-3);
}

.pills {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  min-width: 0;
  scrollbar-width: none;
}
.pills::-webkit-scrollbar {
  display: none;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  background: rgba(17, 22, 28, 0.85);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 10px;
  color: var(--paper-2);
  white-space: nowrap;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}
.pill:hover {
  color: var(--paper-0);
  border-color: var(--line-strong);
  background: var(--ink-3);
}
.pill.on {
  color: var(--paper-0);
  font-weight: 600;
  border-color: var(--ramp-4);
  background: rgba(14, 165, 164, 0.18);
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--paper-3);
}
.pill.on .dot {
  background: var(--ramp-5);
  box-shadow: 0 0 6px var(--ramp-5);
}
</style>
