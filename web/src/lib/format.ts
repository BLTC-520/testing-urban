import { format } from "d3-format";

export const pct = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(digits)}%`;

export const int = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? "–" : format(",.0f")(x);

/** 1,234,567 → "1.23 M"; 12,345 → "12,300" */
export const people = (x: number | null | undefined) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(2)} M`;
  if (Math.abs(x) >= 1e4) return format(",.0f")(Math.round(x / 100) * 100);
  return format(",.0f")(x);
};

export const minutes = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x) ? "> 60 min" : `${x.toFixed(digits)} min`;

export const signed = (x: number, digits = 0) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s\-/(])([a-z])/g, (_, a, b) => a + b.toUpperCase());
