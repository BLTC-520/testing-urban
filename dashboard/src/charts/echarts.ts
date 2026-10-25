/**
 * ECharts set-up: tree-shaken imports and the one shared theme.
 *
 * vue-echarts does not register anything itself — you import only the charts
 * and components you use and call `use()` once. Importing the whole `echarts`
 * bundle instead would add roughly a megabyte for four panels.
 *
 * React equivalent: exactly what you would do with echarts-for-react; the
 * registration step is identical because it belongs to ECharts, not to the
 * framework binding.
 */
import { use } from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent, TooltipComponent, LegendComponent,
  MarkLineComponent, DatasetComponent, GraphicComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import type { CallbackDataParams } from "echarts/types/dist/shared.js";

/**
 * What ECharts hands a label or tooltip formatter. Re-exported from one place
 * because the import path is an internal one and should appear once.
 */
export type FormatParams = CallbackDataParams;

/** `params.value` is a very wide union; charts here always plot numbers. */
export const num = (v: FormatParams["value"]): number => Number(v ?? 0);

use([
  BarChart, LineChart, PieChart,
  GridComponent, TooltipComponent, LegendComponent,
  MarkLineComponent, DatasetComponent, GraphicComponent,
  CanvasRenderer,
]);

/** Read a token so chart colours cannot drift from the stylesheet. */
export const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const PAPER_0 = () => token("--paper-0");
export const PAPER_2 = () => token("--paper-2");
export const PAPER_3 = () => token("--paper-3");
export const LINE = () => token("--line");
export const INK_3 = () => token("--ink-3");

/** The ordinal completeness ramp, 0…6 essentials reached. */
export const ramp = (): string[] =>
  Array.from({ length: 7 }, (_, i) => token(`--ramp-${i}`));

export const cityColor = (city: string): string => token(city === "sg" ? "--sg" : "--jb");
export const catColor = (id: string): string => token(`--cat-${id}`);

/**
 * Shared chart defaults: recessive axes and gridlines, a tooltip on every
 * chart, no animation on data change (a wall display that redraws with a
 * flourish every time a slider moves is noise).
 */
export function base(): EChartsOption {
  return {
    animationDuration: 200,
    animationDurationUpdate: 160,
    textStyle: { fontFamily: token("--font-sans"), fontSize: 11, color: PAPER_2() },
    grid: { left: 8, right: 10, top: 10, bottom: 6, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: token("--ink-4"),
      borderColor: token("--line-strong"),
      borderWidth: 1,
      padding: [6, 9],
      textStyle: { color: PAPER_0(), fontSize: 12, fontFamily: token("--font-sans") },
      extraCssText: "border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.5);",
    },
  };
}

/** Axis defaults — a line only where it carries meaning. */
export function categoryAxis(data: (string | number)[]): Record<string, unknown> {
  return {
    type: "category",
    data,
    axisLine: { lineStyle: { color: token("--line-strong") } },
    axisTick: { show: false },
    axisLabel: { color: PAPER_2(), fontSize: 11 },
  };
}

export function valueAxis(opts: { max?: number; percent?: boolean } = {}): Record<string, unknown> {
  return {
    type: "value",
    max: opts.max,
    splitLine: { lineStyle: { color: LINE() } },
    axisLabel: {
      color: PAPER_3(),
      fontSize: 10,
      formatter: opts.percent ? (v: number) => `${Math.round(v * 100)}%` : undefined,
    },
  };
}
