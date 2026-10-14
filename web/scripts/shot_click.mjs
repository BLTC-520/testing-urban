// Usage: node scripts/shot_click.mjs <url> <out.png> <zoomTo> <lon> <lat> [w] [h]
import { chromium } from "@playwright/test";
const [url, out, zoom, lon, lat, w = "1440", h = "900"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("luma.gl")) logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
// fly the map, then click the requested coordinate
await page.evaluate(([z, x, y]) => window.__map?.jumpTo({ center: [+x, +y], zoom: +z }), [zoom, lon, lat]);
await page.waitForTimeout(2500);
const pt = await page.evaluate(([x, y]) => { const p = window.__map.project([+x, +y]); const r = window.__map.getContainer().getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; }, [lon, lat]);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(6000);
console.log("lastClick", JSON.stringify(await page.evaluate(() => window.__lastClick)));
console.log("selection", JSON.stringify(await page.evaluate(() => window.__explorer?.getState().selection)));
await page.screenshot({ path: out });
console.log(logs.slice(0, 20).join("\n"));
await browser.close();
