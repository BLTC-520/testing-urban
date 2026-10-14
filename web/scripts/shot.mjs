// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs] [scrollY]
import { chromium } from "@playwright/test";

const [url, out, w = "1440", h = "900", wait = "4000", scrollY = "0"] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "networkidle" });
if (+scrollY) await page.evaluate((y) => window.scrollTo(0, y), +scrollY);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes("Download the React DevTools")).slice(0, 30).join("\n"));
await browser.close();
