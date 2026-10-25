/**
 * Map colour ramps, read from the CSS tokens so the map, the charts and the
 * legend can never disagree.
 *
 * The completeness ramp is sequential: one analogous hue family, blue → cyan →
 * mint, with OKLab lightness rising monotonically from 0.299 to 0.914 in even
 * ~0.10 steps. That monotonicity is what makes it readable in greyscale and to
 * a colourblind viewer, and it is why it is not a rainbow.
 *
 * The delta ramp is diverging: two hues with a neutral midpoint, never a hue at
 * the middle. Yellow for a gain, magenta for a loss, dark ink for no change.
 */
export type RGBA = [number, number, number, number];

const read = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function parseHex(h: string): [number, number, number] {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

let rampCache: [number, number, number][] | null = null;
/** The seven ordinal ramp stops, resolved once from the stylesheet. */
function ramp(): [number, number, number][] {
  rampCache ??= Array.from({ length: 7 }, (_, i) => parseHex(read(`--ramp-${i}`)));
  return rampCache;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Continuous position on the completeness ramp; x in [0, 1]. */
export function rampAt(x: number, alpha = 215): RGBA {
  const stops = ramp();
  const t = Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  const k = t - i;
  const [a, b] = [stops[i], stops[i + 1]];
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), alpha];
}

let gainCache: [number, number, number] | null = null;
let lossCache: [number, number, number] | null = null;

/**
 * A change in share, as a diverging colour.
 *
 * Scaled so ±15 percentage points saturates: the largest scenario moves the
 * whole-city share by about 12 points, so a wider domain would make every
 * hexagon look unchanged.
 */
export function hexToRGB(delta: number, full = 0.15): RGBA {
  if (!Number.isFinite(delta)) return [34, 42, 53, 150];
  const t = Math.min(1, Math.abs(delta) / full);
  if (t < 0.02) return [34, 42, 53, 150];          // neutral midpoint, not a hue
  gainCache ??= parseHex(read("--gain"));
  lossCache ??= parseHex(read("--loss"));
  const c = delta >= 0 ? gainCache : lossCache;
  // Lift alpha with magnitude so small changes recede instead of competing.
  return [c[0], c[1], c[2], Math.round(70 + t * 165)];
}

export const css = (c: RGBA | [number, number, number]): string =>
  c.length === 4 ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})` : `rgb(${c.join(",")})`;
