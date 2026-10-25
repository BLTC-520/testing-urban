<!--
  How many of the six essentials residents can reach: the 0…6 distribution.

  Form: magnitude across an ordered scale → columns, coloured on the sequential
  ramp (one hue family, light→dark, monotone OKLab lightness). A single series,
  so no legend box is needed; the title names it and the x-axis carries the
  scale.

  Under a scenario the baseline is drawn as an outline behind each column.
-->
<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import type { EChartsOption } from "echarts";
import { base, categoryAxis, valueAxis, ramp, num, PAPER_0, PAPER_3, LINE, type FormatParams } from "../charts/echarts.ts";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import { people } from "../lib.ts";

const d = useData();
const f = useFilters();

const option = computed<EChartsOption>(() => {
  const hist = d.panels?.histogram ?? [];
  const before = d.baselinePanels?.histogram ?? [];
  const colours = ramp();
  const hasBaseline = f.isScenario && before.length > 0;

  return {
    ...base(),
    grid: { left: 4, right: 6, top: 16, bottom: 2, containLabel: true },
    tooltip: {
      ...base().tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(236,233,226,.05)" } },
      formatter: (p: unknown) => {
        const arr = (Array.isArray(p) ? p : [p]) as FormatParams[];
        const i = arr[0]?.dataIndex ?? 0;
        const row = hist[i];
        const b = before[i];
        const head = `<strong>${i} of 6 essentials</strong>`;
        const nowLine = `${(row.share * 100).toFixed(1)}% · ${people(row.pop)} residents`;
        if (!b) return `${head}<br>${nowLine}`;
        const diff = (row.share - b.share) * 100;
        return `${head}<br>${nowLine}<br><span style="color:${PAPER_3()}">baseline ${(b.share * 100).toFixed(1)}% · ${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} pp</span>`;
      },
    },
    xAxis: {
      ...categoryAxis(hist.map((h) => h.reached)),
      name: "essentials reached",
      nameLocation: "middle",
      nameGap: 20,
      nameTextStyle: { color: PAPER_3(), fontSize: 9 },
    },
    yAxis: { ...valueAxis({ percent: true }), splitLine: { lineStyle: { color: LINE() } } },
    series: [
      ...(hasBaseline ? [{
        name: "Baseline",
        type: "bar" as const,
        barGap: "-100%",
        z: 1,
        silent: true,
        data: before.map((h) => h.share),
        itemStyle: { color: "transparent", borderColor: PAPER_3(), borderWidth: 1, borderRadius: [3, 3, 0, 0] },
      }] : []),
      {
        name: "Share of residents",
        type: "bar" as const,
        z: 2,
        // 2px surface gap between adjacent bars, per the mark specs.
        barCategoryGap: "22%",
        data: hist.map((h) => ({
          value: h.share,
          itemStyle: { color: colours[h.reached] ?? colours[0] },
        })),
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: {
          // Label the complete bar only — it is the headline, the rest is shape.
          show: true, position: "top", color: PAPER_0(), fontSize: 10,
          fontFamily: "var(--font-mono)",
          formatter: (p: FormatParams) =>
            p.dataIndex === hist.length - 1 ? `${(num(p.value) * 100).toFixed(0)}%` : "",
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
