// Prerender the built site so every page is readable without JavaScript.
//
//   node scripts/prerender.mjs            (after `vite build`; `npm run build:site` runs both)
//
// For each page it loads the built app in headless Chromium, waits until the
// data-driven text is in place, and writes that DOM (minus map canvases) into
// dist/<page>/index.html with the page's own title, description, canonical URL
// and structured data. React replaces it on load. From the same DOM it writes
// Markdown copies of the pages, llms.txt / llms-full.txt for AI agents,
// robots.txt, sitemap.xml and a data catalogue — all derived from what the
// site renders, so they cannot drift from it.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(WEB, "dist");
const SITE_URL = (process.env.SITE_URL ?? "https://sgjburbansideprojects.brianhar.site").replace(/\/$/, "");
const BASE = (process.env.BASE_PATH ?? "/").replace(/\/?$/, "/");
const REPO = "https://github.com/BLTC-520/testing-urban";
const TODAY = new Date().toISOString().slice(0, 10);

const PAGES = [
  { path: "/", out: "index.html", md: "index.md", ready: ".story .hero h1, .story h1", scroll: true },
  { path: "/explore/", out: "explore/index.html", md: "explore.md", ready: "#explorer-panel" },
  { path: "/methods/", out: "methods/index.html", md: "methods.md", ready: "#architecture .katex, #architecture" },
];

const DATA = [
  ["summary.json", "Every headline number: city results, 50 neighbourhoods, sensitivity grid, Overture re-run, urban form, audits, scenario results"],
  ["meta.json", "Parameters and provenance: essentials taxonomy, walking speeds, thresholds, cross-border assumptions, data sources with licences and checksums"],
  ["neighbourhoods.geojson", "Neighbourhood outlines (Singapore planning areas, Johor Bahru state constituencies) with their access statistics"],
  ["parking_sites.geojson", "Car parks ranked by the Parking-to-Proximity scenario, with the residents each would bring to all six essentials"],
  ["study_mask.geojson", "Study area outline"],
  ["pois_sg.json", "Names and kinds of the Singapore destinations (OpenStreetMap)"],
  ["pois_jb.json", "Names and kinds of the Johor Bahru destinations (OpenStreetMap)"],
];

const shell = readFileSync(join(DIST, "index.html"), "utf8");
if (shell.includes("data-prerendered")) throw new Error("dist/index.html is already prerendered — run `vite build` first");

const server = await preview({ root: WEB, preview: { port: 0, strictPort: false, open: false }, logLevel: "warn" });
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const results = [];
try {
  for (const page of PAGES) {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const errors = [];
    tab.on("pageerror", (e) => errors.push(e.message));
    await tab.goto(origin + BASE.replace(/\/$/, "") + page.path, { waitUntil: "networkidle", timeout: 120_000 });
    await tab.waitForSelector(page.ready, { timeout: 60_000 });
    if (page.scroll) {
      // later chapters load their data as the reader approaches; walk down the page once
      await tab.evaluate(async () => {
        const step = window.innerHeight * 0.6;
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
      });
      await tab.waitForLoadState("networkidle");
      await tab.waitForTimeout(800);
      await tab.evaluate(() => window.scrollTo(0, 0));
      await tab.waitForTimeout(300);
    }
    const snap = await tab.evaluate(snapshot, SITE_URL);
    if (errors.length) throw new Error(`${page.path}: page errors:\n${errors.join("\n")}`);
    if (snap.text.length < 500) throw new Error(`${page.path}: only ${snap.text.length} characters of text — data did not load?`);
    results.push({ ...page, ...snap });
    console.log(`prerendered ${page.path.padEnd(10)} ${String(snap.text.length).padStart(6)} chars of text, ${snap.markdown.length} chars of markdown`);
    await tab.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

// ---------------------------------------------------------------- HTML pages
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const pageUrl = (p) => SITE_URL + BASE.replace(/\/$/, "") + p;

for (const r of results) {
  let html = shell;
  const set = (re, value) => {
    if (!re.test(html)) throw new Error(`${r.path}: shell has no ${re}`);
    html = html.replace(re, value);
  };
  set(/<title>[^<]*<\/title>/, `<title>${esc(r.title)}</title>`);
  set(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${esc(r.description)}$2`);
  set(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(r.title)}$2`);
  set(/(<meta property="og:url" content=")[^"]*(")/, `$1${pageUrl(r.path)}$2`);
  set(/(<link rel="canonical" href=")[^"]*(")/, `$1${pageUrl(r.path)}$2`);
  const extraCss = r.styles.filter((h) => !html.includes(`href="${h}"`)).map((h) => `    <link rel="stylesheet" crossorigin href="${h}">\n`);
  const alternates = [
    `    <link rel="alternate" type="text/markdown" href="${BASE}${r.md}" title="This page as Markdown">\n`,
    `    <link rel="help" type="text/plain" href="${BASE}llms.txt" title="Guide for AI agents">\n`,
    `    <script type="application/ld+json">${JSON.stringify(jsonLd(r)).replace(/</g, "\\u003c")}</script>\n`,
  ];
  set(/<\/head>/, `${extraCss.join("")}${alternates.join("")}  </head>`);
  set(/<div id="root"><\/div>/, `<div id="root" data-prerendered>${r.html}</div>`);
  set(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript><p class="noscript-note">The maps and calculators need JavaScript; everything else on this page is readable without it. Agents: see <a href="${BASE}llms.txt">llms.txt</a>.</p></noscript>`,
  );
  mkdirSync(dirname(join(DIST, r.out)), { recursive: true });
  writeFileSync(join(DIST, r.out), html);
}

// unknown paths: GitHub Pages serves 404.html, which boots the app's "not found" view
writeFileSync(
  join(DIST, "404.html"),
  shell.replace(/<title>[^<]*<\/title>/, "<title>Page not found — SG / JB 15-Minute City Explorer</title>").replace("</head>", '    <meta name="robots" content="noindex">\n  </head>'),
);

// ---------------------------------------------------------- agent & crawler files
const story = results.find((r) => r.path === "/");
const methods = results.find((r) => r.path === "/methods/");
const explore = results.find((r) => r.path === "/explore/");

const exploreMd = [
  `# Explorer — interactive map`,
  ``,
  `URL: ${pageUrl("/explore/")}`,
  ``,
  explore.description,
  ``,
  `The map colours every inhabited hexagon (H3 resolution 10, about 0.015 km²) by how many of the six essentials its residents can walk to, or by the walking time to one essential. Click a point to walk the street network from it.`,
  ``,
  `## Link to any view`,
  ``,
  `Every setting is in the URL, so a view can be linked or opened directly. Parameters (all optional):`,
  ``,
  `| Parameter | Values |`,
  `|---|---|`,
  ...Object.entries(explore.explorerParams).map(([k, v]) => `| \`${k}\` | ${v.replace(/\|/g, "\\|")} |`),
  ``,
  `Examples:`,
  ``,
  `- Healthcare within 10 minutes for slower walkers: ${pageUrl("/explore/")}?metric=healthcare&minutes=10&speed=slow`,
  `- Walk from Johor Bahru Sentral: ${pageUrl("/explore/")}?lon=103.76463&lat=1.46297`,
  `- Bedok with 25 car parks converted to neighbourhood hubs: ${pageUrl("/explore/")}?scenario=p2p25&unit=BD`,
  ``,
  `## On the page`,
  ``,
  `A control panel chooses the essential (or all six), the time budget, walking speed, population group, one alternative assumption and a scenario, and jumps to a neighbourhood. A legend explains the colours. Clicking the map walks the street network from that point and lists the nearest destination of each essential. In-page tools for agents (\`window.sgjb\`, WebMCP) do the same without the map: see ${pageUrl("/llms.txt")}.`,
  ``,
].join("\n");

writeFileSync(join(DIST, story.md), story.markdown);
writeFileSync(join(DIST, methods.md), methods.markdown);
writeFileSync(join(DIST, explore.md), exploreMd);

const catalogue = {
  title: "Singapore / Johor Bahru 15-Minute City Explorer — published data",
  site: pageUrl("/"),
  repository: REPO,
  licence: "Code MIT; data under the licences of their sources (OpenStreetMap data ODbL). See DATA_LICENSES.md in the repository.",
  generated: TODAY,
  files: DATA.filter(([f]) => existsSync(join(DIST, "data", f))).map(([f, description]) => ({
    url: pageUrl(`/data/${f}`),
    description,
    bytes: statSync(join(DIST, "data", f)).size,
  })),
  binary_tables:
    "The *.bin files (per-cell distances, scenarios, the street graph) are compact column tables for the web app; their format is documented in docs/architecture.md and the pipeline that writes them is in src/sgjb/export.py.",
};
writeFileSync(join(DIST, "data", "index.json"), JSON.stringify(catalogue, null, 2) + "\n");

const llms = [
  `# Singapore / Johor Bahru 15-Minute City Explorer`,
  ``,
  `> ${story.description}`,
  ``,
  `An open, reproducible street-network study. Every number on the site is computed from published data (OpenStreetMap, the 2020 censuses of Singapore and Malaysia, Meta/CIESIN HRSL population, LTA and myBAS transit data, Overture Places) by the pipeline in the repository. Results are labelled as observed, calculated, modelled, assumed or scenario.`,
  ``,
  `## Key findings`,
  ``,
  ...headline(),
  ...story.findings.map(([statement, share, verdict]) => `- ${statement} — holds in ${share} of the sensitivity runs (${verdict}).`),
  ``,
  `## Pages`,
  ``,
  `- [Story](${pageUrl("/")}): the findings as a scrolling narrative ([Markdown](${pageUrl("/" + story.md)}))`,
  `- [Explorer](${pageUrl("/explore/")}): interactive map; every view has a URL ([Markdown with URL parameters](${pageUrl("/" + explore.md)}))`,
  `- [Methods](${pageUrl("/methods/")}): data, formulas, validation, sensitivity, limitations ([Markdown](${pageUrl("/" + methods.md)}))`,
  `- [Full text](${pageUrl("/llms-full.txt")}): Story and Methods in one file`,
  ``,
  `## Data`,
  ``,
  `- [Data catalogue](${pageUrl("/data/index.json")}): the published files with descriptions`,
  ...catalogue.files.map((f) => `- [${f.url.split("/").pop()}](${f.url}): ${f.description}`),
  ``,
  `## Tools in the page`,
  ``,
  `In a browser, the site exposes these tools through WebMCP (\`navigator.modelContext\`) when available, and always as \`window.sgjb\`, e.g. \`await sgjb.call("walk_from", { lon: 103.7646, lat: 1.463 })\`:`,
  ``,
  ...explore.tools.map((t) => `- \`${t.name}\`(${Object.keys(t.inputSchema.properties ?? {}).join(", ")}): ${t.description}`),
  ``,
  `## Optional`,
  ``,
  `- [Source code and pipeline](${REPO})`,
  `- [Case study](${REPO}/blob/main/docs/case-study.md)`,
  `- [Architecture](${REPO}/blob/main/docs/architecture.md)`,
  `- [Data licences](${REPO}/blob/main/DATA_LICENSES.md)`,
  ``,
].join("\n");
writeFileSync(join(DIST, "llms.txt"), llms);
writeFileSync(join(DIST, "llms-full.txt"), [llms, "\n---\n", story.markdown, "\n---\n", methods.markdown, "\n---\n", exploreMd].join("\n"));

writeFileSync(
  join(DIST, "robots.txt"),
  `# Everything here is public. AI crawlers welcome; agents start at /llms.txt\nUser-agent: *\nAllow: /\n\nSitemap: ${pageUrl("/sitemap.xml")}\n`,
);
writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(
    (p) => `  <url><loc>${pageUrl(p.path)}</loc><lastmod>${TODAY}</lastmod></url>`,
  ).join("\n")}\n</urlset>\n`,
);
console.log("wrote", PAGES.map((p) => p.out).join(", "), "404.html, *.md, llms.txt, llms-full.txt, robots.txt, sitemap.xml, data/index.json");

// ---------------------------------------------------------------- helpers
function headline() {
  const s = JSON.parse(readFileSync(join(DIST, "data", "summary.json"), "utf8"));
  const p = (x) => `${(x * 100).toFixed(1)}%`;
  const n = (x) => Math.round(x).toLocaleString("en-US");
  const sg = s.cities.sg.all;
  const jb = s.cities.jb.all;
  return [
    `- Residents who can walk to all six everyday essentials within 15 minutes: Singapore ${p(sg.share_complete)} of ${n(sg.population)}, Johor Bahru ${p(jb.share_complete)} of ${n(jb.population)} (2020 censuses).`,
    `- Low access (fewer than three of six): Singapore ${p(sg.share_low_access)}, Johor Bahru ${p(jb.share_low_access)} (${n(jb.low_access_population)} people).`,
    ...["sg", "jb"].map((c) => {
      const a = s.cities[c].all;
      const k = s.basket.reduce((m, x) => (a[`share_within_${x}`] < a[`share_within_${m}`] ? x : m));
      return `- Essential most often out of reach in ${c === "sg" ? "Singapore" : "Johor Bahru"}: ${k.replace("_", " ")} (${p(a[`share_within_${k}`])} of residents within 15 minutes).`;
    }),
  ];
}

function jsonLd(r) {
  const site = { "@type": "WebSite", "@id": `${pageUrl("/")}#site`, name: "Singapore / Johor Bahru 15-Minute City Explorer", url: pageUrl("/") };
  const page = { "@type": "WebPage", url: pageUrl(r.path), name: r.title, description: r.description, isPartOf: { "@id": site["@id"] }, dateModified: TODAY };
  const dataset = {
    "@type": "Dataset",
    name: "Walking access to everyday essentials, Singapore and Johor Bahru",
    description:
      "Street-network walking distance from every inhabited H3 cell to six everyday essentials, population-weighted by census unit, with sensitivity runs and scenario results.",
    url: pageUrl("/"),
    license: "https://opendatacommons.org/licenses/odbl/1-0/",
    isAccessibleForFree: true,
    spatialCoverage: [
      { "@type": "Place", name: "Singapore" },
      { "@type": "Place", name: "Johor Bahru District, Malaysia" },
    ],
    temporalCoverage: "2020/2026",
    keywords: ["15-minute city", "accessibility", "walkability", "OpenStreetMap", "Singapore", "Johor Bahru", "RTS Link"],
    distribution: DATA.map(([f]) => ({ "@type": "DataDownload", contentUrl: pageUrl(`/data/${f}`), encodingFormat: f.endsWith(".geojson") ? "application/geo+json" : "application/json" })),
    isBasedOn: REPO,
  };
  return { "@context": "https://schema.org", "@graph": r.path === "/" ? [site, page, dataset] : [site, page] };
}

/** Runs in the page: cleaned DOM for the HTML, and a Markdown rendering for agents. */
function snapshot(siteUrl) {
  const root = document.getElementById("root").cloneNode(true);
  // drop what only works with JavaScript: map canvases and their positioned overlays, tooltips
  root.querySelectorAll("canvas, script, .maplibregl-control-container, .maplibregl-marker, .maplibregl-popup, .viz-tip, .hover-card, .map-key").forEach((n) => n.remove());
  root.querySelectorAll(".maplibregl-map").forEach((n) => {
    n.className = n.className.replace(/\bmaplibregl-\S+/g, "").trim();
    n.replaceChildren();
  });
  root.querySelectorAll(".is-active").forEach((n) => n.classList.remove("is-active"));
  const first = root.querySelector(".story-step");
  first?.classList.add("is-active");

  const abs = (h) => {
    try {
      const u = new URL(h, location.href);
      return u.origin === location.origin ? siteUrl + u.pathname + u.search + u.hash : u.href;
    } catch {
      return h;
    }
  };

  // ---- Markdown
  const md = [];
  // elements laid out as boxes (block, flex items, inline-block chips) are separated, not run together
  const gap = (el) => {
    const d = getComputedStyle(el).display;
    return d === "inline" || d === "contents" ? "" : /^inline/.test(d) ? " " : "\n";
  };
  const inline = (node) => {
    let s = "";
    for (const c of node.childNodes) {
      if (c.nodeType === 3) s += c.textContent.replace(/\s+/g, " ");
      else if (c.nodeType === 1) {
        const g = c.tagName === "BR" ? "" : gap(c);
        s += g + inlineEl(c) + g;
      }
    }
    return s;
  };
  const inlineEl = (el) => {
    if (el.getAttribute("aria-hidden") === "true" && !el.classList.contains("katex-html")) return "";
    if (el.classList.contains("katex")) {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? el.textContent;
      return `$${tex.trim()}$`;
    }
    if (el.classList.contains("badge")) return ` [${el.textContent.trim()}]`;
    const t = el.tagName;
    if (t === "BR") return "\n";
    if (t === "SVG" || t === "svg") return el.getAttribute("aria-label") ? `(chart: ${el.getAttribute("aria-label")})` : "";
    if (t === "BUTTON" || t === "INPUT" || t === "SELECT") return "";
    const body = inline(el);
    if (!body.trim()) return body;
    if (t === "A") return `[${body.trim()}](${abs(el.getAttribute("href") ?? "")})`;
    if (t === "STRONG" || t === "B") return `**${body.trim()}**`;
    if (t === "EM" || t === "I") return `*${body.trim()}*`;
    if (t === "CODE") return `\`${body.trim()}\``;
    return body;
  };
  const clean = (s) => s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  const display = (el) => getComputedStyle(el).display;
  const isBox = (el) => {
    const d = display(el);
    return d !== "inline" && d !== "contents" && !d.startsWith("inline") ? true : ["svg", "TABLE", "UL", "OL", "FIGURE", "P"].includes(el.tagName);
  };
  const walk = (el) => {
    if (el.nodeType !== 1) return;
    if (el.getAttribute("aria-hidden") === "true" || display(el) === "none") return;
    const t = el.tagName;
    if (t === "NAV" || el.classList.contains("site-header") || t === "BUTTON" || t === "SCRIPT" || t === "STYLE" || t === "SUMMARY" || el.getAttribute("role") === "radiogroup") return;
    if (/^H[1-6]$/.test(t)) return md.push(`${"#".repeat(+t[1])} ${clean(inline(el)).replace(/\s*\n\s*/g, " ")}`);
    if (t === "P" || t === "FIGCAPTION" || t === "BLOCKQUOTE") {
      const s = clean(inline(el));
      if (s) md.push(t === "BLOCKQUOTE" ? `> ${s}` : s);
      return;
    }
    if (t === "UL" || t === "OL") {
      const items = [...el.children].filter((c) => c.tagName === "LI").map((li, i) => `${t === "OL" ? `${i + 1}.` : "-"} ${clean(inline(li)).replace(/\n/g, " ")}`);
      if (items.length) md.push(items.join("\n"));
      return;
    }
    if (t === "TABLE") {
      const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => clean(inline(c)).replace(/\|/g, "\\|").replace(/\n/g, " ")));
      if (!rows.length) return;
      const w = Math.max(...rows.map((r) => r.length));
      const line = (r) => `| ${[...r, ...Array(w - r.length).fill("")].join(" | ")} |`;
      md.push([line(rows[0]), `|${" --- |".repeat(w)}`, ...rows.slice(1).map(line)].join("\n"));
      return;
    }
    if (el.classList?.contains("formula")) {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (tex) md.push(`$$\n${tex.trim()}\n$$`);
      const cap = el.querySelector("figcaption");
      if (cap) md.push(clean(inline(cap)));
      return;
    }
    if (t === "svg") {
      if (el.getAttribute("aria-label")) md.push(`*Chart: ${el.getAttribute("aria-label")}*`);
      return;
    }
    if (t === "PRE") return md.push("```\n" + el.textContent.trim() + "\n```");
    if (t === "DL") {
      const out = [];
      for (const c of el.children) out.push(c.tagName === "DT" ? `**${clean(inline(c))}**` : clean(inline(c)));
      return md.push(out.join("\n"));
    }
    // a container: runs of inline content become paragraphs, box children are walked
    if (![...el.children].some(isBox)) {
      const s = clean(inline(el));
      if (s.length > 1) md.push(s);
      return;
    }
    let run = "";
    const flush = () => {
      const s = clean(run);
      if (s.length > 1) md.push(s);
      run = "";
    };
    for (const c of el.childNodes) {
      if (c.nodeType === 3) run += c.textContent.replace(/\s+/g, " ");
      else if (c.nodeType === 1 && !isBox(c)) run += inlineEl(c);
      else if (c.nodeType === 1) {
        flush();
        walk(c);
      }
    }
    flush();
  };
  walk(document.getElementById("root"));
  const markdown = md.filter((b, i) => b && b !== md[i - 1]).join("\n\n") + "\n";

  const findings = [...document.querySelectorAll("table.findings tr")]
    .map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()))
    .filter((r) => r.length >= 2 && r[0])
    .slice(1);

  return {
    html: root.innerHTML,
    text: document.getElementById("root").innerText,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    styles: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((l) => new URL(l.href, location.href))
      .filter((u) => u.origin === location.origin)
      .map((u) => u.pathname),
    markdown,
    findings,
    explorerParams: window.sgjb?.explorerParams ?? {},
    tools: window.sgjb?.tools ?? [],
  };
}
