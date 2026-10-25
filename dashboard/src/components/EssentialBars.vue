<!--
  Share of residents who can reach each essential within the current budget.

  Form: magnitude across named categories → horizontal bars, sorted ascending so
  the scarcest essential is read first. 4px rounded data-ends anchored to the
  baseline, per the mark specs.

  When a scenario is active a second, recessive bar shows the baseline behind
  each one, so the gain is visible without a second chart or a second axis.
-->
<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import type { EChartsOption } from "echarts";
import { base, valueAxis, catColor, num, PAPER_0, PAPER_2, PAPER_3, LINE, type FormatParams } from "../charts/echarts.ts";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";

const d = useData();
const f = useFilters();

const rows = computed(() => {
  const now = d.panels?.by_essential ?? [];
  const before = d.baselinePanels?.by_essential ?? [];
  const labels = new Map((d.summary?.essentials ?? []).map((e) => [e.id, e.label]));
  return [...now]
    .map((e) => ({
      id: e.id,
      label: labels.get(e.id) ?? e.id,
      value: e.share_within,
      baseline: before.find((x) => x.id === e.id)?.share_within ?? null,
    }))
    // Descending: ECharts stacks a category axis from the bottom up, so this
    // puts the scarcest essential at the top of the panel.
    .sort((a, b) => b.value - a.value);
});

const option = computed<EChartsOption>(() => {
  const r = rows.value;
  const hasBaseline = f.isScenario && r.some((x) => x.baseline !== null);
  return {
    ...base(),
    grid: { left: 4, right: 46, top: 4, bottom: 2, containLabel: true },
    tooltip: {
      ...base().tooltip,
      trigger: "item",
      formatter: (p: unknown) => {
        const pt = (Array.isArray(p) ? p[0] : p) as FormatParams;
        const row = r[pt.dataIndex];
        const head = `<strong>${row.label}</strong>`;
        const nowLine = `${(row.value * 100).toFixed(1)}% within ${f.minutes} min`;
        if (row.baseline === null) return `${head}<br>${nowLine}`;
        const diff = (row.value - row.baseline) * 100;
        return `${head}<br>${nowLine}<br><span style="color:${PAPER_3()}">baseline ${(row.baseline * 100).toFixed(1)}% · ${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} pp</span>`;
      },
    },
    xAxis: { ...valueAxis({ percent: true, max: 1 }), splitLine: { lineStyle: { color: LINE() } } },
    yAxis: {
      type: "category",
      data: r.map((x) => x.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: PAPER_2(), fontSize: 11 },
    },
    series: [
      ...(hasBaseline ? [{
        name: "Baseline",
        type: "bar" as const,
        // Same category axis, drawn behind: an outline, not a competing fill.
        barGap: "-100%",
        barWidth: 11,
        z: 1,
        data: r.map((x) => x.baseline ?? 0),
        itemStyle: {
          color: "transparent",
          borderColor: PAPER_3(),
          borderWidth: 1,
          borderRadius: [0, 3, 3, 0],
        },
        silent: true,
      }] : []),
      {
        name: f.isScenario ? "Scenario" : "Within reach",
        type: "bar" as const,
        barWidth: 11,
        z: 2,
        data: r.map((x) => ({ value: x.value, itemStyle: { color: catColor(x.id) } })),
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: {
          show: true, position: "right", distance: 6,
          color: PAPER_0(), fontSize: 11, fontFamily: "var(--font-mono)",
          formatter: (p: FormatParams) => `${(num(p.value) * 100).toFixed(0)}%`,
        },
      },
    ],
  };
});
</script>

<template>
  <VChart class="chart" :option="option" autoresize />
</template>

<style scoped>
.chart { width: 100%; height: 100%; }
</style>
