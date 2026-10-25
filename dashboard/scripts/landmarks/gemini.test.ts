import { describe, expect, it } from "vitest";
import { DEFAULT_HEIGHT_M, parsePicks, requestBody } from "./gemini.ts";
import type { Candidate } from "./overpass.ts";

const candidates: Candidate[] = [
  { osmId: "way/1", name: "Esplanade Theatres on the Bay", city: "sg", lat: 1.2896, lon: 103.8559, heightM: 40, tags: { amenity: "theatre" } },
  { osmId: "node/2", name: "Bangunan Sultan Ibrahim", city: "jb", lat: 1.4573, lon: 103.7612, heightM: null, tags: { historic: "building" } },
];

/** Wraps picks the way Gemini's generateContent returns text. */
const answer = (picks: unknown) => ({
  candidates: [{ content: { parts: [{ text: typeof picks === "string" ? picks : JSON.stringify(picks) }] } }],
});

const good = { osmId: "way/1", kind: "culture", importance: 0.8, note: "Twin-domed arts centre on Marina Bay" };

describe("the Gemini request", () => {
  it("lists every candidate by id and asks for schema-checked JSON", () => {
    const body = requestBody(candidates, 40);
    const prompt = body.contents[0].parts[0].text;
    expect(prompt).toContain("way/1");
    expect(prompt).toContain("node/2");
    expect(prompt).toContain("40");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.items.properties.kind.enum).toContain("culture");
  });
});

describe("reading Gemini's picks", () => {
  it("builds landmarks from OSM's name, city and position, and the model's judgement", () => {
    const { landmarks, rejected } = parsePicks(answer([good, { ...good, osmId: "node/2", kind: "civic", importance: 0.7 }]), candidates);
    expect(rejected).toEqual([]);
    expect(landmarks[0]).toEqual({
      id: "osm-way-1", name: "Esplanade Theatres on the Bay", city: "sg", kind: "culture",
      importance: 0.8, note: good.note, position: [103.8559, 1.2896, 40],
    });
    expect(landmarks[1].position[2]).toBe(DEFAULT_HEIGHT_M);
  });

  it("rejects a pick for a place that was never a candidate, so no coordinates are invented", () => {
    const { landmarks, rejected } = parsePicks(answer([{ ...good, osmId: "way/999" }]), candidates);
    expect(landmarks).toEqual([]);
    expect(rejected[0]).toMatch(/way\/999/);
  });

  it("rejects unknown kinds, scores off the 0–1 scale, empty or overlong notes, and repeats", () => {
    const { landmarks, rejected } = parsePicks(answer([
      { ...good, kind: "spaceport" },
      { ...good, importance: 1.4 },
      { ...good, note: " " },
      { ...good, note: "x".repeat(200) },
      good,
      good,
    ]), candidates);
    expect(landmarks).toHaveLength(1);
    expect(rejected).toHaveLength(5);
  });

  it("fails loudly when the answer is not JSON or not a list", () => {
    expect(() => parsePicks(answer("Sure! Here are the landmarks:"), candidates)).toThrow(/JSON/);
    expect(() => parsePicks(answer({ picks: [] }), candidates)).toThrow(/array/);
    expect(() => parsePicks({ error: { message: "quota" } }, candidates)).toThrow(/quota/);
  });
});
