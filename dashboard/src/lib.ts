/** Number and label formatting. Shared by the tiles, the charts and the map. */

const nf = new Intl.NumberFormat("en-GB");
const nf1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
/** Millions need two places or 4,041,984 and 4,499,000 both read "4M". */
const nf2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const int = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : nf.format(Math.round(v));

/** A population, abbreviated for a tile: 4,044,340 → "4.04M". */
export function people(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e6) return `${nf2.format(v / 1e6)}M`;
  if (Math.abs(v) >= 1e4) return `${nf1.format(v / 1e3)}k`;
  return nf.format(Math.round(v));
}

export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

/** A signed change in percentage points: +6.5 pp. */
export const pp = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)} pp`;

export const metres = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "beyond reach"
    : v >= 1000 ? `${nf1.format(v / 1000)} km` : `${Math.round(v)} m`;

/** Distance in metres → walking minutes at a given speed. */
export const minutesAt = (m: number | null | undefined, speedMps: number): number | null =>
  m === null || m === undefined || !Number.isFinite(m) ? null : m / speedMps / 60;

export const mins = (m: number | null | undefined, speedMps: number): string => {
  const v = minutesAt(m, speedMps);
  return v === null ? "beyond reach" : `${nf1.format(v)} min`;
};

/** "green_space" → "Green space", for when the API's label is not to hand. */
export const titleise = (id: string): string =>
  id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
