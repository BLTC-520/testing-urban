/**
 * Fit a fixed 1920×1080 stage into whatever viewport it is given, keeping 16:9.
 *
 * Why a fixed stage and a transform, rather than a fluid responsive layout:
 * this is designed for one wall display at a known size. Everything — type
 * sizes, chart gridlines, the map's pixel dimensions, the gaps between panels —
 * is laid out once at 1920×1080 and then scaled as a single unit. The
 * alternative, a fluid layout with clamp() type, means the design is never
 * exactly the thing that was designed, and ECharts has to re-measure and
 * re-layout on every resize.
 *
 * `transform: scale()` is also cheap: it is a composited property, so a browser
 * window resize costs no reflow and no chart re-render.
 *
 * React equivalent: a custom hook returning the scale, with the same
 * ResizeObserver inside a useEffect. `onScopeDispose` replaces the effect's
 * cleanup function; `ref` replaces useState; computed replaces useMemo.
 */
import { onMounted, onScopeDispose, ref } from "vue";

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export function useStageScale() {
  const scale = ref(1);

  const fit = () => {
    // Round down slightly so a sub-pixel overflow never produces a scrollbar.
    const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    scale.value = Math.floor(s * 1000) / 1000;
  };

  onMounted(() => {
    fit();
    window.addEventListener("resize", fit, { passive: true });
    // A window resize event is not fired when the element itself is resized by
    // a parent layout, which happens when this is embedded rather than full-page.
    const ro = new ResizeObserver(fit);
    ro.observe(document.documentElement);
    onScopeDispose(() => {
      window.removeEventListener("resize", fit);
      ro.disconnect();
    });
  });

  return { scale, STAGE_W, STAGE_H };
}
