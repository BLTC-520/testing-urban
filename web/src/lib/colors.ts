/** Colour system. Keep in sync with src/styles/tokens.css. */

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

export function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Ordinal ramp (analogous blue→mint, monotone OKLCH lightness); keep in sync with tokens.css. */
export const RAMP: RGB[] = ["#222a51", "#22477d", "#10699f", "#0b8eaf", "#1cb4b6", "#6ad5b6", "#b6f4ca"].map(hex);

/** City identity (validated categorical pair on the dark surface). */
export const SG: RGB = hex("#e75438");
export const JB: RGB = hex("#3b89e9");
/** De-emphasised reference series (e.g. today's baseline in a scenario chart). */
export const NEUTRAL: RGB = hex("#8a8f98");
/** Scenario highlight (newly complete cells, the RTS station): warm against the cool ramp, CVD-safe vs teal. */
export const GAIN: RGB = hex("#ffd166");
export const LOSS: RGB = hex("#ff4fa3");

/** Essentials, in list order (validated adjacent set). Supplementary layers use the neutral mark. */
export const CATEGORY_COLOR: Record<string, RGB> = {
  groceries: hex("#be8609"),
  healthcare: hex("#dc4b6e"),
  education: hex("#5f8adf"),
  green_space: hex("#2da962"),
  transit: hex("#9c70d0"),
  dining: hex("#d3772e"),
  rapid_transit: hex("#c3c7cf"),
  civic: hex("#c3c7cf"),
};

export const cssRGB = (c: RGB, a = 1) => (a === 1 ? `rgb(${c.join(",")})` : `rgba(${c.join(",")},${a})`);

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Continuous position on the ramp, x in [0, 1]. */
export function rampAt(x: number): RGB {
  const t = Math.min(1, Math.max(0, x)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t));
  return lerp(RAMP[i], RAMP[i + 1], t - i);
}

/** Walking minutes → colour: short is luminous, long is dim. */
export function minutesColor(min: number, maxMin = 30): RGB {
  if (!Number.isFinite(min)) return RAMP[0];
  return rampAt(1 - Math.min(min, maxMin) / maxMin);
}

/** Border/regional minutes (cross-border scenario): 20–120 min range. */
export function regionalColor(min: number): RGB {
  if (!Number.isFinite(min)) return RAMP[0];
  return rampAt(1 - (Math.min(Math.max(min, 20), 120) - 20) / 100);
}
