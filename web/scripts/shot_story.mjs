// Usage: node scripts/shot_story.mjs <baseUrl> <outDir> [width] [height] [waitMs] [only]
// Scrolls the story to each [data-scene] step and saves a screenshot of each.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [base, outDir, w = "1440", h = "900", wait = "3500", only = ""] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => m.type() !== "log" && logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(base + "#/", { waitUntil: "networkidle" });
await page.waitForTimeout(+wait);
const n = await page.evaluate(() => document.querySelectorAll("[data-scene]").length);
for (let i = 0; i < n; i++) {
  const scene = await page.evaluate((i) => {
    const el = document.querySelectorAll("[data-scene]")[i];
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - window.innerHeight * 0.3));
    return el.dataset.scene;
  }, i);
  if (only && !only.split(",").includes(scene)) continue;
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: `${outDir}/s${String(i).padStart(2, "0")}_${scene}.png` });
  console.log(i, scene);
}
console.log(logs.slice(0, 30).join("\n"));
await browser.close();
