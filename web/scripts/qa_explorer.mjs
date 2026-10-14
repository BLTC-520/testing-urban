// Usage: node scripts/qa_explorer.mjs <url> <outDir>
// Drives the explorer through assumption changes, saving a screenshot and the headline figures for each.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url + "explore/", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
const cases = [
  ["baseline", {}],
  ["p2p25", { scenario: "p2p25" }],
  ["overture", { scenario: "none", poiSource: "overture" }],
  ["strict-network", { poiSource: "osm", network: "strict" }],
  ["broad", { network: "permissive", taxonomy: "broad" }],
  ["elderly-slow", { taxonomy: "core", people: "elderly", speed: "slow" }],
  ["healthcare-10", { people: "all", speed: "base", metric: "healthcare", threshold: 10 }],
];
for (const [name, state] of cases) {
  await page.evaluate((s) => window.__explorer.getState().set(s), state);
  await page.waitForTimeout(3500);
  const figs = await page.evaluate(() => Array.from(document.querySelectorAll(".pstat-value")).map((e) => e.textContent));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(name, JSON.stringify(figs));
}
console.log("errors:", errors.length ? errors.slice(0, 10).join("\n") : "none");
await browser.close();
