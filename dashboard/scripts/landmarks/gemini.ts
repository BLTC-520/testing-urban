/**
 * Gemini's part: judging which OSM candidates deserve a callout, how much, and
 * writing the one-line note. The same role Gemini plays in snaproom's semantic
 * scan, minus the vision step: here the places come from OSM with coordinates,
 * so the model only ever refers to them by OSM id and cannot misplace one.
 *
 * Everything it returns is treated as untrusted: checked against the candidate
 * list, the kind vocabulary and the 0–1 scale before it reaches the map.
 */
import { LANDMARK_KINDS, type Landmark, type LandmarkKind } from "../../src/map/landmarkTypes.ts";
import type { Candidate } from "./overpass.ts";

/** Roof height for a callout when OSM has neither a height nor a storey count. */
export const DEFAULT_HEIGHT_M = 30;
const MAX_NOTE_CHARS = 120;
const TIMEOUT_MS = 300_000;
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const KIND_GUIDE: Record<LandmarkKind, string> = {
  icon: "skyline-defining or nationally famous structures",
  culture: "museums, theatres, galleries, major places of worship, heritage buildings",
  education: "universities, colleges, arts schools",
  transport: "border crossings, airports, major interchanges",
  health: "major hospitals",
  civic: "government seats, palaces, notable public housing",
  retail: "major malls and markets",
  leisure: "parks, gardens, stadiums, theme parks",
};

export interface GeminiRequest {
  contents: [{ parts: [{ text: string }] }];
  generationConfig: {
    temperature: number;
    responseMimeType: "application/json";
    responseSchema: {
      type: "ARRAY";
      items: {
        type: "OBJECT";
        properties: {
          osmId: { type: "STRING" };
          kind: { type: "STRING"; enum: string[] };
          importance: { type: "NUMBER" };
          note: { type: "STRING" };
        };
        required: string[];
      };
    };
  };
}

function candidateLine(c: Candidate): string {
  const tags = Object.entries(c.tags).map(([k, v]) => `${k}=${v}`).join(",");
  return [c.osmId, c.city, c.name, tags, c.heightM ? `${c.heightM}m` : ""].join(" | ");
}

export function buildPrompt(candidates: readonly Candidate[], count: number): string {
  const kinds = LANDMARK_KINDS.map((k) => `- ${k}: ${KIND_GUIDE[k]}`).join("\n");
  return `You are choosing landmarks for a wall-display dashboard about 15-minute-city access in Singapore (sg) and Johor Bahru (jb). As the 3D map camera flies over the two cities, a few landmarks at a time get a callout, so a viewer always knows where they are.

From the candidates below (OpenStreetMap places, one per line: osmId | city | name | tags | height), choose about ${count} that a viewer would most want named.
Prefer places that orient a viewer or matter to daily access: famous skyline buildings, the Causeway crossings, major hospitals, universities and arts schools, heritage sites, big parks and transport hubs.
Include Johor Bahru fairly: at least a quarter of the picks should be jb.
Skip near-duplicates: if a mall, shop or park sits inside or beside a more notable complex, pick only the more notable one.

For each pick return:
- "osmId": copied exactly from the list. Never invent one.
- "kind": one of
${kinds}
- "importance": 0.0 to 1.0, how much a viewer would want this named. Reserve 0.9+ for a handful of city-defining places; most picks should be 0.4–0.8. Do not inflate.
- "note": one factual line, at most 90 characters, in plain English. No marketing language. Leave out anything you are not sure is true.

Candidates:
${candidates.map(candidateLine).join("\n")}`;
}

export function requestBody(candidates: readonly Candidate[], count: number): GeminiRequest {
  return {
    contents: [{ parts: [{ text: buildPrompt(candidates, count) }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            osmId: { type: "STRING" },
            kind: { type: "STRING", enum: [...LANDMARK_KINDS] },
            importance: { type: "NUMBER" },
            note: { type: "STRING" },
          },
          required: ["osmId", "kind", "importance", "note"],
        },
      },
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The text of Gemini's first candidate, or a thrown error naming what went wrong. */
function answerText(response: unknown): string {
  if (!isRecord(response)) throw new Error("Gemini returned no response object");
  if (isRecord(response.error)) throw new Error(`Gemini error: ${String(response.error.message)}`);
  const first = Array.isArray(response.candidates) ? response.candidates[0] : undefined;
  const parts = isRecord(first) && isRecord(first.content) && Array.isArray(first.content.parts) ? first.content.parts : [];
  return parts.map((p) => (isRecord(p) && typeof p.text === "string" ? p.text : "")).join("");
}

/** Why a pick is unusable, or null if it is fine. */
function problem(pick: unknown, byId: ReadonlyMap<string, Candidate>, seen: ReadonlySet<string>): string | null {
  if (!isRecord(pick)) return "not an object";
  const { osmId, kind, importance, note } = pick;
  if (typeof osmId !== "string" || !byId.has(osmId)) return `unknown osmId ${String(osmId)}`;
  if (seen.has(osmId)) return `${osmId} picked twice`;
  if (!(LANDMARK_KINDS as readonly unknown[]).includes(kind)) return `${osmId}: unknown kind ${String(kind)}`;
  if (typeof importance !== "number" || !(importance >= 0 && importance <= 1)) return `${osmId}: importance ${String(importance)} off the 0–1 scale`;
  if (typeof note !== "string" || note.trim() === "") return `${osmId}: empty note`;
  if (note.trim().length > MAX_NOTE_CHARS) return `${osmId}: note longer than ${MAX_NOTE_CHARS} characters`;
  return null;
}

/**
 * Landmarks from Gemini's answer. Name, city and position come from the OSM
 * candidate; only kind, importance and note come from the model.
 */
export function parsePicks(
  response: unknown, candidates: readonly Candidate[],
): { landmarks: Landmark[]; rejected: string[] } {
  const text = answerText(response);
  let picks: unknown;
  try {
    picks = JSON.parse(text);
  } catch {
    throw new Error(`Gemini did not return JSON: ${text.slice(0, 120)}`);
  }
  if (!Array.isArray(picks)) throw new Error("Gemini returned JSON but not an array of picks");

  const byId = new Map(candidates.map((c) => [c.osmId, c]));
  const result = picks.reduce<{ landmarks: Landmark[]; rejected: string[]; seen: ReadonlySet<string> }>((acc, pick) => {
    const why = problem(pick, byId, acc.seen);
    if (why) return { ...acc, rejected: [...acc.rejected, why] };
    const p = pick as { osmId: string; kind: LandmarkKind; importance: number; note: string };
    const c = byId.get(p.osmId)!;
    const landmark: Landmark = {
      id: `osm-${p.osmId.replace("/", "-")}`,
      name: c.name, city: c.city, kind: p.kind,
      importance: Math.round(p.importance * 100) / 100,
      note: p.note.trim(),
      position: [c.lon, c.lat, c.heightM ?? DEFAULT_HEIGHT_M],
    };
    return { ...acc, landmarks: [...acc.landmarks, landmark], seen: new Set([...acc.seen, p.osmId]) };
  }, { landmarks: [], rejected: [], seen: new Set() });
  return { landmarks: result.landmarks, rejected: result.rejected };
}

/** One generateContent call. The key travels in a header, never in the URL, so it stays out of logs. */
export async function callGemini(apiKey: string, model: string, body: GeminiRequest): Promise<unknown> {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = isRecord(json) && isRecord(json.error) ? String(json.error.message) : res.statusText;
    throw new Error(`Gemini ${model} answered ${res.status}: ${message}`);
  }
  return json;
}
