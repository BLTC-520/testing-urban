import type { PagePath } from "./router";

/** Per-page <title> and description, set in the browser and baked into the prerendered HTML. */
export const SITE = "Singapore / Johor Bahru 15-Minute City Explorer";

export const PAGE_META: Record<PagePath, { title: string; description: string }> = {
  "/": {
    title: SITE,
    description:
      "An open, reproducible study of everyday walking access in Singapore and Johor Bahru — street-network accessibility for 5.8 million people, the RTS Link across the border, and what autonomous mobility could change.",
  },
  "/explore": {
    title: `Explorer — ${SITE}`,
    description:
      "Interactive map of walking access to six everyday essentials in Singapore and Johor Bahru. Change the walking speed, time budget, assumptions and scenarios, or walk the street network from any point.",
  },
  "/methods": {
    title: `Methods — ${SITE}`,
    description:
      "Data sources, street-network model, accessibility formulas, population model, validation, sensitivity analysis and limitations of the Singapore / Johor Bahru 15-minute city study.",
  },
  "/about": {
    title: `About — ${SITE}`,
    description:
      "Who made the Singapore / Johor Bahru 15-Minute City Explorer, how it was built with an AI coding assistant, the three main decisions behind the method and how its results were checked.",
  },
};

export function applyPageMeta(path: string): void {
  const m = PAGE_META[path as PagePath];
  if (!m) return;
  document.title = m.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", m.description);
}
