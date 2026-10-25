import { describe, expect, it } from "vitest";
import { CURATED, LANDMARKS, listLandmarks, mergeLandmarks } from "./landmarks.ts";
import type { Landmark } from "./landmarkTypes.ts";
import { STUDY_AREA } from "./studyArea.ts";

describe("the landmark catalogue", () => {
  it("gives every landmark its own id", () => {
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(LANDMARKS.length);
  });

  it("keeps every landmark inside the study area, where the camera can reach it", () => {
    const [w, s, e, n] = STUDY_AREA;
    for (const { id, position: [lon, lat] } of LANDMARKS) {
      expect({ id, inside: lon > w && lon < e && lat > s && lat < n }).toEqual({ id, inside: true });
    }
  });

  it("ranks on the 0–1 scale the selection expects, with roofs above ground", () => {
    for (const l of LANDMARKS) {
      expect(l.importance).toBeGreaterThan(0);
      expect(l.importance).toBeLessThanOrEqual(1);
      expect(l.position[2]).toBeGreaterThan(0);
    }
  });

  it("places Johor's landmarks north of the strait and Singapore's south of the Causeway", () => {
    const woodlands = LANDMARKS.find((l) => l.id === "woodlands")!.position[1];
    for (const l of LANDMARKS) {
      if (l.city === "sg") expect(l.position[1]).toBeLessThanOrEqual(woodlands);
    }
    const ciq = LANDMARKS.find((l) => l.id === "ciq")!.position[1];
    expect(ciq).toBeGreaterThan(woodlands);
  });
});

describe("merging the hand-written list with Gemini's", () => {
  const at = (id: string, lon: number, lat: number, importance = 0.7): Landmark => ({
    id, name: id, city: "sg", kind: "icon", note: "n", importance, position: [lon, lat, 30],
  });
  const mbs = at("mbs", 103.86072, 1.2837, 1);

  it("keeps every hand-written landmark", () => {
    expect(mergeLandmarks([mbs], []).map((l) => l.id)).toEqual(["mbs"]);
  });

  it("drops a generated place that is a hand-written one under another name", () => {
    // OSM's "Sultan Iskandar Building" is 12 m from the hand-written CIQ point.
    const ciq = at("ciq", 103.76673, 1.465);
    const osmCiq = at("osm-ciq", 103.76662, 1.46499);
    expect(mergeLandmarks([ciq], [osmCiq]).map((l) => l.id)).toEqual(["ciq"]);
  });

  it("keeps a generated neighbour, however close, that is a different place", () => {
    // Parliament House stands ~180 m from the National Gallery.
    const gallery = at("gallery", 103.85147, 1.29026);
    const parliament = at("parliament", 103.8501, 1.2894);
    expect(mergeLandmarks([gallery], [parliament]).map((l) => l.id)).toEqual(["gallery", "parliament"]);
  });

  it("collapses generated near-duplicates to the more important one", () => {
    const lesser = at("merlion-statue", 103.85443, 1.28681, 0.4);
    const park = at("merlion-park", 103.85416, 1.28669, 0.8);
    expect(mergeLandmarks([], [lesser, park]).map((l) => l.id)).toEqual(["merlion-park"]);
  });

  it("keeps generated places that stand apart", () => {
    const far = at("jewel", 103.9897, 1.3602);
    expect(mergeLandmarks([mbs], [far]).map((l) => l.id)).toEqual(["mbs", "jewel"]);
  });

  it("ignores generated entries that are not landmarks", () => {
    expect(mergeLandmarks([], [{ id: "broken" }, at("ok", 103.9, 1.35)]).map((l) => l.id)).toEqual(["ok"]);
  });

  it("includes the whole hand-written list in what the map uses", () => {
    const ids = new Set(LANDMARKS.map((l) => l.id));
    expect(CURATED.every((l) => ids.has(l.id))).toBe(true);
  });
});

describe("the city Landmarks list: order and dedupe", () => {
  const mk = (
    id: string,
    name: string,
    city: "sg" | "jb",
    kind: Landmark["kind"],
    lon: number,
    lat: number,
    importance: number,
  ): Landmark => ({
    id, name, city, kind, note: "n", importance, position: [lon, lat, 30],
  });

  it("scopes to the requested city and never mixes Singapore and Johor Bahru", () => {
    expect(listLandmarks("sg").every((l) => l.city === "sg")).toBe(true);
    expect(listLandmarks("jb").every((l) => l.city === "jb")).toBe(true);
    expect(listLandmarks("sg").some((l) => l.id === "nafa")).toBe(true);
    expect(listLandmarks("jb").some((l) => l.id === "ciq")).toBe(true);
  });

  it("dedupes duplicate ids, case-insensitive names and <100 m neighbours, keeping the higher-ranked one", () => {
    const sample = Object.freeze([
      mk("a1", "Marina Bay Sands", "sg", "icon", 103.8607, 1.2837, 0.7),
      mk("a2", "marina bay sands", "sg", "icon", 103.9000, 1.3200, 0.95),
      mk("b1", "Raffles Hotel", "sg", "icon", 103.8546, 1.2947, 0.62),
      mk("b1", "Raffles Duplicate Id", "sg", "icon", 103.9200, 1.3500, 0.5),
      mk("near-b", "Raffles Arcade", "sg", "retail", 103.8547, 1.2947, 0.4),
    ]);
    const out = listLandmarks("sg", "importance", sample);
    expect(out.map((l) => l.id)).toEqual(["a2", "b1"]);
  });

  it("sorts by importance (descending), name (A–Z) or kind without mutating the source", () => {
    const sample = Object.freeze([
      mk("z", "Zeta Hall", "sg", "education", 103.80, 1.30, 0.9),
      mk("a", "Alpha Tower", "sg", "icon", 103.82, 1.32, 0.6),
      mk("m", "Mid Museum", "sg", "culture", 103.84, 1.34, 0.75),
    ]);
    expect(listLandmarks("sg", "importance", sample).map((l) => l.id)).toEqual(["z", "m", "a"]);
    expect(listLandmarks("sg", "name", sample).map((l) => l.id)).toEqual(["a", "m", "z"]);
    expect(listLandmarks("sg", "kind", sample).map((l) => l.kind)).toEqual(["culture", "education", "icon"]);
  });
});
