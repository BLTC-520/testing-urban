<!--
  Share with complete access as the walk budget grows, for both cities, with a
  marker on the budget currently selected.

  Form: change over an ordered quantity → a line. Two series, so a legend is
  present and both are direct-labelled at their last point (dataviz: identity
  must never be colour-alone).

  This panel reads the pipeline's pre-computed `by_threshold` series rather than
  querying the API per threshold: it is a fixed reference curve, not a function
  of the filters, so it should not move when the slider does. The marker is what
  moves.
-->
<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import type { EChartsOption } from "echarts";
import { base, categoryAxis, valueAxis, cityColor, PAPER_0, PAPER_3, INK_3 } from "../charts/echarts.ts";
import { useData } from "../stores/data.ts";
import { useFilters } from "../stores/filters.ts";
import type { CityId, SummaryResponse } from "../api/types.ts";

const d = useData();
const f = useFilters();

const option = computed<EChartsOption>(() => {
  const cities = (d.summary?.cities ?? []).map((c) => c.id as CityId);
  const series: SummaryResponse["series"] = d.summary?.series ?? ({} as SummaryResponse["series"]);
  const buckets = series[cities[0]]?.by_threshold?.map((p: { bucket: string }) => Number(p.bucket)) ?? [];

  return {
    ...base(),
    legend: {
      show: true, top: 0, right: 0, itemWidth: 9, itemHeight: 9, itemGap: 12,
      textStyle: { color: PAPER_3(), fontSize: 10 },
      icon: "roundRect",
    },
    grid: { left: 4, right: 40, top: 22, bottom: 4, containLabel: true },
    tooltip: { ...base().tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "rgba(236,233,226,.22)" } },
      valueFormatter: (v) => `${((v as number) * 100).toFixed(1)}%` },
    xAxis: { ...categoryAxis(buckets), name: "minutes", nameLocation: "end", nameGap: 6,
      nameTextStyle: { color: PAPER_3(), fontSize: 9, align: "left" } },
    yAxis: valueAxis({ percent: true, max: 1 }),
    series: cities.map((city) => {
      const name = d.summary?.cities.find((c) => c.id === city)?.name ?? city;
      const points: { bucket: string; value: number }[] = series[city]?.by_threshold ?? [];
      return {
        name,
        type: "line" as const,
        data: points.map((p) => p.value),
        smooth: false,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { width: 2, color: cityColor(city) },
        itemStyle: { color: cityColor(city), borderColor: INK_3(), borderWidth: 2 },
        // Direct label on the last point only — never a number on every point.
        endLabel: {
          show: true, color: PAPER_0(), fontSize: 11, distance: 6,
          formatter: () => name,
        },
        emphasis: { focus: "series" as const },
        // The budget currently on screen, so the curve says where we are.
        markLine: city === f.city ? {
          silent: true, symbol: "none",
          label: { show: true, formatter: `${f.minutes} min`, color: PAPER_3(), fontSize: 9, position: "insideEndTop" },
          lineStyle: { color: "rgba(236,233,226,.3)", width: 1, type: "dashed" as const },
          data: [{ xAxis: String(f.minutes) }],
        } : undefined,
      };
    }),
  };
});
</script>

<template>
  <VChart class="chart" :option="option" autoresize />
</template>

<style scoped>
.chart { width: 100%; height: 100%; }
</style>
