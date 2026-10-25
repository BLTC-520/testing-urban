/**
 * npm run landmarks — regenerate src/map/landmarks.generated.json.
 *
 *   1. OSM candidates for each country inside the study area (Overpass).
 *   2. Gemini picks, ranks and annotates them, by OSM id only.
 *   3. Every pick is validated; the survivors are written with provenance.
 *
 * Run by hand, not at build time: the output is reviewed and committed like
 * any other data file, and the browser never sees the API key.
 * Needs GEMINI_API_KEY in dashboard/.env.local; GEMINI_MODEL overrides the model.
 */
import { writeFile } from "node:fs/promises";
import { STUDY_AREA } from "../../src/map/studyArea.ts";
import { callGemini, parsePicks, requestBody } from "./gemini.ts";
import { fetchCandidates } from "./overpass.ts";

const OUT = new URL("../../src/map/landmarks.generated.json", import.meta.url);
/** Flash, because Gemini's free tier allows no Pro requests; GEMINI_MODEL picks Pro on a paid key. */
const DEFAULT_MODEL = "gemini-3-flash-preview";
/** About how many places to ask for; the map shows at most five at once. */
const PICK_COUNT = 48;

const say = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to dashboard/.env.local (no VITE_ prefix).");
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

  // One country at a time: the public Overpass servers are shared and often busy.
  say("Fetching OSM candidates…");
  const sg = await fetchCandidates("SG", "sg", STUDY_AREA);
  const jb = await fetchCandidates("MY", "jb", STUDY_AREA);
  const candidates = [...sg, ...jb];
  say(`  ${sg.length} in Singapore, ${jb.length} in Johor`);

  say(`Asking ${model} to choose about ${PICK_COUNT}…`);
  const response = await callGemini(apiKey, model, requestBody(candidates, PICK_COUNT));
  const { landmarks, rejected } = parsePicks(response, candidates);
  for (const why of rejected) say(`  rejected: ${why}`);
  if (landmarks.length === 0) throw new Error("No usable picks; the existing file is left as it was.");

  const file = {
    generatedAt: new Date().toISOString(),
    model,
    source: "OpenStreetMap contributors (ODbL), via the Overpass API",
    candidates: candidates.length,
    landmarks,
  };
  await writeFile(OUT, `${JSON.stringify(file, null, 2)}\n`);
  const jbCount = landmarks.filter((l) => l.city === "jb").length;
  say(`Wrote ${landmarks.length} landmarks (${landmarks.length - jbCount} sg, ${jbCount} jb), ${rejected.length} rejected.`);
}

main().catch((err: unknown) => {
  process.stderr.write(`landmarks: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
