// Usage: node scripts/shot_landmarks.mjs <baseUrl> <outDir> [waitMs] [only,…]
// Drives /landmarks.html through every landmark and saves a screenshot of each.
//
// The models are generated from numbers, so the thing that can go wrong is not
// a crash but a wrong one: a tower rotated across the bay instead of along it,
// a model at a tenth of its size, a landmark standing in the water. None of
// that is assertable, so this leaves a sheet of pictures for a human to check.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [base = "http://127.0.0.1:5174", outDir = ".landmark-shots", wait = "3500", only = ""] =
  process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => m.type() === "error" && logs.push(`[error] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`${base}/landmarks.html`, { waitUntil: "load" });
// The page sets this once the basemap's load event has fired; waiting on a
// timeout instead gives an empty canvas on a cold tile cache.
await page.waitForFunction(() => window.__landmarksReady === true, { timeout: 60_000 });

const ids = await page.evaluate(() => window.__landmarks.map((l) => l.id));
for (const id of ids) {
  if (only && !only.split(",").includes(id)) continue;
  await page.evaluate((i) => window.__show(i), id);
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: `${outDir}/${id}.png` });
  console.log(" ", id);
}
if (logs.length) console.log(logs.slice(0, 20).join("\n"));
await browser.close();
console.log(`${ids.length} landmarks → ${outDir}`);
