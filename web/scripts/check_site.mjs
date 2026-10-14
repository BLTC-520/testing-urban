// End-to-end checks of the built, prerendered site (run after `npm run build:site`):
//
//   node scripts/check_site.mjs
//
// 1. what a crawler or AI reader gets without JavaScript (raw HTML, Markdown, llms.txt, …)
// 2. the app taking over in a browser: no errors, real URLs, old #/ links, Explorer URL state
// 3. the agent tools, through window.sgjb and through a WebMCP-style navigator.modelContext
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await preview({ root: WEB, preview: { port: 0, open: false }, logLevel: "warn" });
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${String(e.message).split("\n").join("\n        ")}`);
  }
}
const get = async (path) => {
  const r = await fetch(origin + path);
  assert.equal(r.status, 200, `${path}: HTTP ${r.status}`);
  return r.text();
};
const textOf = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ");

try {
  console.log("Without JavaScript (what crawlers and AI readers fetch)");
  await check("story HTML carries the findings", async () => {
    const html = await get("/");
    const t = textOf(html);
    assert.match(html, /<div id="root" data-prerendered>/);
    for (const s of ["Fifteen minutes", "80.4%", "12.0%", "One region, two answers", "How sure are we?"]) assert.ok(t.includes(s), `missing "${s}"`);
    assert.ok(t.length > 15000, `only ${t.length} characters`);
    assert.match(html, /<link rel="canonical" href="https:\/\/sgjburbansideprojects\.brianhar\.site\/"\s*\/?>/);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.ok(ld["@graph"].some((n) => n["@type"] === "Dataset"));
  });
  await check("story and methods HTML include the footpath scenario, its still map and alternatives", async () => {
    const fp = JSON.parse(await get("/data/footpath.json"));
    const html = await get("/");
    assert.ok(textOf(html).includes(`A ${Math.round(fp.chosen.link_m)}-metre path in ${fp.chosen.place}`), "footpath heading missing");
    assert.match(html, /<svg[^>]*class="fp-map"/);
    assert.ok(!html.includes("data-loading"), "a lazy section was captured while loading");
    const methods = await get("/methods/");
    assert.ok(methods.includes('id="footpath"'));
    for (const alt of fp.alternatives.slice(0, 3)) assert.ok(textOf(methods).includes(alt.unit_name), alt.unit_name);
  });
  await check("methods HTML has its own title, sections and formulas (MathML + TeX)", async () => {
    const html = await get("/methods/");
    const t = textOf(html);
    assert.match(html, /<title>Methods — /);
    assert.match(html, /<link rel="canonical" href="https:\/\/sgjburbansideprojects\.brianhar\.site\/methods\/"\s*\/?>/);
    assert.match(html, /\/assets\/Methods-[\w-]+\.css/, "Methods stylesheet not linked");
    for (const s of ["Question & scope", "Data register", "Sensitivity", "Limitations"]) assert.ok(t.includes(s), `missing "${s}"`);
    assert.ok((html.match(/class="katex"/g) ?? []).length >= 10, "formulas missing");
    assert.match(html, /<math[\s>]/);
    assert.ok(html.includes("C_i(\\tau)"), "TeX annotation missing");
  });
  await check("explorer HTML describes the page", async () => {
    const html = await get("/explore/");
    assert.match(html, /<title>Explorer — /);
    assert.ok(textOf(html).includes("What can people reach on foot?"));
  });
  await check("about HTML names the author, the AI assistance and the three decisions", async () => {
    const html = await get("/about/");
    const t = textOf(html);
    assert.match(html, /<title>About — /);
    for (const s of ["Brian Har", "Claude Code", "Measure walks on the street network, not circles", "Place people with census totals and a settlement map", "A static site that computes in the browser"]) {
      assert.ok(t.includes(s), `missing "${s}"`);
    }
  });
  await check("about.md exists", async () => {
    assert.match(await get("/about.md"), /^# Who made this, and how$/m);
  });
  await check("every page advertises its Markdown copy and llms.txt", async () => {
    for (const [p, md] of [["/", "/index.md"], ["/methods/", "/methods.md"], ["/explore/", "/explore.md"]]) {
      const html = await get(p);
      assert.ok(html.includes(`rel="alternate" type="text/markdown" href="${md}"`), `${p} → ${md}`);
      assert.ok(html.includes('href="/llms.txt"'));
    }
  });
  await check("Markdown copies", async () => {
    const story = await get("/index.md");
    assert.match(story, /^# Fifteen minutes from home$/m);
    assert.match(story, /\| 6 of 6 \| 80\.4% \| 12\.0% \|/);
    const methods = await get("/methods.md");
    assert.match(methods, /^## Metrics$/m);
    assert.match(methods, /^\$\$\nC_i\(\\tau\) = /m);
    assert.match(methods, /^\| Source \| Class \| Licence \| Used for \|$/m);
    const explore = await get("/explore.md");
    assert.match(explore, /\| `minutes` \| 5 \\\| 10 \\\| 15 \\\| 20/);
  });
  await check("llms.txt, llms-full.txt, robots.txt, sitemap.xml, data/index.json", async () => {
    const llms = await get("/llms.txt");
    assert.match(llms, /^# Singapore \/ Johor Bahru 15-Minute City Explorer$/m);
    assert.match(llms, /Singapore 80\.4% of 4,044,340 residents .*, Johor Bahru 12\.0% of 1,753,284 people/);
    for (const t of ["get_city_summary", "find_neighbourhoods", "walk_from", "get_footpath_scenario", "open_explorer"]) assert.ok(llms.includes(`\`${t}\``), t);
    const full = await get("/llms-full.txt");
    assert.ok(full.length > 40000 && full.includes("## Metrics") && full.includes("# Fifteen minutes from home"));
    const robots = await get("/robots.txt");
    assert.match(robots, /^Allow: \/$/m);
    assert.match(robots, /^Sitemap: https:\/\/sgjburbansideprojects\.brianhar\.site\/sitemap\.xml$/m);
    const sitemap = await get("/sitemap.xml");
    assert.equal((sitemap.match(/<loc>/g) ?? []).length, 4);
    const cat = JSON.parse(await get("/data/index.json"));
    assert.ok(cat.files.length >= 5 && cat.files.every((f) => f.bytes > 0));
  });

  console.log("In a browser");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
  // a stand-in for a browser's WebMCP implementation, to check registration and execution
  await ctx.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(navigator, "modelContext", { value: { registerTool: (t) => tools.set(t.name, t) }, configurable: true });
    window.__webmcp = tools;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message} ${(e.stack ?? "").split("\n")[1]?.trim() ?? ""}`));
  page.on("console", (m) => {
    if (m.type() !== "error" || /WebGL|GPU|swiftshader/i.test(m.text())) return;
    const at = m.location();
    errors.push(`${new URL(page.url()).pathname}: ${m.text()} (${at.url ? `${at.url.split("/").pop()}:${at.lineNumber}` : "no location"})`);
  });

  await check("story boots over the prerendered page without errors", async () => {
    await page.goto(origin + "/", { waitUntil: "networkidle" });
    await page.waitForSelector(".story canvas", { timeout: 30000 });
    assert.equal(await page.getAttribute("#root", "data-prerendered"), null);
    assert.equal(await page.locator(".story .hero h1").count(), 1, "hero rendered twice or not at all");
    assert.deepEqual(errors, []);
  });
  await check("header links navigate without a reload", async () => {
    await page.evaluate(() => (window.__sameDocument = true));
    await page.click('nav[aria-label="Primary"] >> text=Methods');
    await page.waitForSelector("#architecture");
    assert.equal(new URL(page.url()).pathname, "/methods/");
    assert.equal(await page.evaluate(() => window.__sameDocument), true);
    assert.match(await page.title(), /^Methods — /);
    await page.goBack();
    await page.waitForSelector(".story .hero h1");
    assert.equal(new URL(page.url()).pathname, "/");
  });
  await check("old #/ links land on the new URLs", async () => {
    await page.goto("about:blank");
    await page.goto(origin + "/#/explore?metric=transit", { waitUntil: "networkidle" });
    await page.waitForURL(origin + "/explore/?metric=transit", { timeout: 15000 });
    await page.waitForSelector("#explorer-panel");
    assert.equal(await page.evaluate(() => window.__explorer.getState().metric), "transit");
  });
  await check("Explorer state comes from and goes to the URL", async () => {
    await page.goto(origin + "/explore/?metric=healthcare&minutes=10&speed=slow", { waitUntil: "networkidle" });
    await page.waitForSelector("#explorer-panel");
    const s = await page.evaluate(() => {
      const st = window.__explorer.getState();
      return [st.metric, st.threshold, st.speed];
    });
    assert.deepEqual(s, ["healthcare", 10, "slow"]);
    await page.click('[role="radiogroup"][aria-label="Time threshold"] >> text=20 min');
    await page.waitForFunction(() => location.search.includes("minutes=20"));
    assert.equal(new URL(page.url()).search, "?metric=healthcare&minutes=20&speed=slow");
  });
  await check("a point in the URL is walked from (city inferred)", async () => {
    await page.goto(origin + "/explore/?lon=103.76463&lat=1.46297", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__explorer.getState().selection?.city === "jb", null, { timeout: 30000 });
    await page.waitForSelector(".inspector", { timeout: 30000 });
    await page.waitForFunction(() => location.search.includes("city=jb"));
  });
  await check("methods deep link scrolls to its section", async () => {
    await page.goto(origin + "/methods/#sensitivity", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.scrollY > 1000);
  });
  await check("unknown paths show a not-found page", async () => {
    await page.goto(origin + "/no-such-page/", { waitUntil: "networkidle" });
    await page.waitForSelector("text=Nothing within walking distance here");
  });

  console.log("Agent tools");
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await check("registered with navigator.modelContext", async () => {
    const names = await page.evaluate(() => [...window.__webmcp.keys()]);
    assert.deepEqual(names, ["get_city_summary", "find_neighbourhoods", "walk_from", "get_footpath_scenario", "open_explorer"]);
    const out = await page.evaluate(() => window.__webmcp.get("get_city_summary").execute({ city: "jb" }));
    const r = JSON.parse(out.content[0].text);
    assert.equal(r.cities[0].percent_with_all_six_essentials_within_15_min, 12);
    assert.equal(r.cities[0].residents, 1753284);
  });
  await check("get_city_summary matches the published numbers", async () => {
    const r = await page.evaluate(() => window.sgjb.call("get_city_summary"));
    assert.deepEqual(
      r.cities.map((c) => [c.city, c.percent_with_all_six_essentials_within_15_min, c.percent_low_access]),
      [
        ["sg", 80.4, 2],
        ["jb", 12, 37.9],
      ],
    );
    assert.equal(r.cities[0].essentials.length, 6);
  });
  await check("find_neighbourhoods searches and ranks", async () => {
    const r = await page.evaluate(() => window.sgjb.call("find_neighbourhoods", { query: "bedok" }));
    assert.equal(r.neighbourhoods[0].name, "Bedok");
    assert.match(r.neighbourhoods[0].explorer_url, /\/explore\/\?unit=BD$/);
    const worst = await page.evaluate(() => window.sgjb.call("find_neighbourhoods", { city: "jb", sort: "least_complete", limit: 3 }));
    assert.equal(worst.neighbourhoods.length, 3);
    assert.ok(worst.neighbourhoods[0].percent_with_all_six_within_15_min <= worst.neighbourhoods[2].percent_with_all_six_within_15_min);
  });
  await check("walk_from walks the network from JB Sentral and Toa Payoh", async () => {
    const jb = await page.evaluate(() => window.sgjb.call("walk_from", { lon: 103.76463, lat: 1.46297 }));
    assert.equal(jb.from.city, "Johor Bahru");
    assert.equal(jb.essentials.length, 6);
    assert.ok(jb.essentials.find((e) => e.id === "transit").within_time, "no transit near JB Sentral?");
    const sg = await page.evaluate(() => window.sgjb.call("walk_from", { lon: 103.8481, lat: 1.3356, minutes: 10, speed: "slow" }));
    assert.equal(sg.from.city, "Singapore");
    assert.equal(sg.minutes, 10);
    assert.equal(sg.walking_speed_mps, 0.9);
    const sea = await page.evaluate(() => window.sgjb.call("walk_from", { lon: 104.2, lat: 1.2 }));
    assert.ok(sea.error, "a point at sea should be rejected");
  });
  await check("get_footpath_scenario reports the chosen link and site checks", async () => {
    const r = await page.evaluate(() => window.sgjb.call("get_footpath_scenario"));
    assert.ok(r.chosen.link_m > 0 && r.chosen.link_m <= 80);
    assert.ok(r.chosen.residents_gaining_an_essential_within_15_min > 0);
    assert.ok(r.site_checks.length >= 3 && r.alternatives.length >= 3);
  });
  await check("open_explorer navigates and returns a shareable URL", async () => {
    const r = await page.evaluate(() => window.sgjb.call("open_explorer", { metric: "green_space", minutes: 10, unit: "BD" }));
    assert.match(r.url, /\/explore\/\?metric=green_space&minutes=10&unit=BD$/);
    await page.waitForSelector("#explorer-panel");
    assert.equal(await page.evaluate(() => window.__explorer.getState().metric), "green_space");
  });
  await check("no errors in the browser session", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
