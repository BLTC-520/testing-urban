// Render one still image per Story scene, for browsers that cannot run the live map.
//
//   npm run build && node scripts/stills.mjs        (writes public/img/story/<scene>.jpg)
//
// Loads the built Story in headless Chromium (software WebGL), hides the text,
// header, legend and attribution, scrolls to each step so the map shows that
// scene, waits until the basemap and layers have settled, and saves the map
// alone. Re-run after the data or the scenes change; the images are committed.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(WEB, "public", "img", "story");
mkdirSync(OUT, { recursive: true });

const server = await preview({ root: WEB, preview: { port: 0, open: false }, logLevel: "warn" });
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.waitForSelector(".story canvas", { timeout: 60_000 });
  await page.addStyleTag({
    content: `.chapters, .site-header, .map-key, .maplibregl-control-container { visibility: hidden !important; }`,
  });
  const scenes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-scene]")].map((el, i) => ({ i, scene: el.dataset.scene })).filter((s) => s.scene !== "hold"),
  );
  // the border lab shows the still of whichever mode is selected
  const done = new Set(["border-lab"]);
  for (const { i, scene } of scenes) {
    if (done.has(scene)) continue;
    done.add(scene);
    await page.evaluate((i) => {
      const el = document.querySelectorAll("[data-scene]")[i];
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - window.innerHeight * 0.3), behavior: "instant" });
    }, i);
    // the camera jumps (reduced motion); wait for tiles, then for layer transitions to finish
    await page.waitForFunction(() => {
      const m = window.__map;
      return m && m.loaded() && m.areTilesLoaded() && !m.isMoving();
    }, null, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, `${scene}.jpg`), type: "jpeg", quality: 74 });
    console.log("still", scene);
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
