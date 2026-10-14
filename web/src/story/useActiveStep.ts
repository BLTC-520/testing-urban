import { useEffect, useState } from "react";

/**
 * Scrollytelling: the active step is the last `[data-scene]` element whose top
 * has crossed the viewport's reading line (55 % down). Using scroll position
 * rather than intersection ratios keeps the answer stable for tall steps and
 * fast scrolling, and works the same with keyboard and touch scrolling.
 */
export interface ActiveStep {
  /** scene of the step under the reading line ("hold" for essays) */
  scene: string;
  index: number;
  /** the nearest map scene at or above it: what the map shows while an essay covers it */
  held: string;
}

export function useActiveStep(root: React.RefObject<HTMLElement | null>, deps: unknown[] = []): ActiveStep {
  const [active, setActive] = useState<ActiveStep>({ scene: "hero", index: 0, held: "hero" });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const steps = () => Array.from(el.querySelectorAll<HTMLElement>("[data-scene]"));
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.55;
      const list = steps();
      let best = 0;
      for (let i = 0; i < list.length; i++) {
        if (list[i].getBoundingClientRect().top <= line) best = i;
        else break;
      }
      const scene = list[best]?.dataset.scene ?? "hero";
      let held = "hero";
      for (let i = best; i >= 0; i--) {
        const sc = list[i].dataset.scene;
        if (sc && sc !== "hold") {
          held = sc;
          break;
        }
      }
      setActive((prev) => (prev.index === best && prev.scene === scene && prev.held === held ? prev : { scene, index: best, held }));
      list.forEach((s, i) => s.classList.toggle("is-active", i === best));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return active;
}
