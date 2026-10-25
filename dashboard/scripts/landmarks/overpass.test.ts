import { describe, expect, it } from "vitest";
import { heightOf, overpassQuery, parseCandidates } from "./overpass.ts";

const response = (elements: unknown[]) => ({ elements });

describe("the Overpass query", () => {
  it("asks for one country's named, Wikidata-tagged places inside the box, with a centre point each", () => {
    const q = overpassQuery("MY", [103.3, 1.1, 104.3, 1.85]);
    expect(q).toContain('area["ISO3166-1"="MY"][admin_level=2]');
    expect(q).toContain("(1.1,103.3,1.85,104.3)"); // Overpass wants south,west,north,east
    expect(q).toContain('["wikidata"]');
    expect(q).toContain("out center tags;");
  });
});

describe("reading Overpass candidates", () => {
  it("takes a node's own point and a way's centre", () => {
    const got = parseCandidates(response([
      { type: "node", id: 1, lat: 1.3, lon: 103.8, tags: { name: "A", tourism: "museum" } },
      { type: "way", id: 2, center: { lat: 1.4, lon: 103.7 }, tags: { name: "B", amenity: "hospital" } },
    ]), "sg");
    expect(got.map((c) => [c.osmId, c.lat, c.lon, c.city])).toEqual([
      ["node/1", 1.3, 103.8, "sg"],
      ["way/2", 1.4, 103.7, "sg"],
    ]);
  });

  it("prefers the English name, since the callouts are in English", () => {
    const [c] = parseCandidates(response([
      { type: "node", id: 1, lat: 1.46, lon: 103.75, tags: { name: "Masjid Sultan Abu Bakar", "name:en": "Sultan Abu Bakar Mosque" } },
    ]), "jb");
    expect(c.name).toBe("Sultan Abu Bakar Mosque");
  });

  it("skips elements with no name or no position instead of failing the run", () => {
    expect(parseCandidates(response([
      { type: "node", id: 1, tags: { name: "No point" } },
      { type: "node", id: 2, lat: 1.3, lon: 103.8, tags: {} },
      "junk",
    ]), "sg")).toEqual([]);
  });

  it("keeps only the tags that describe the place, not every OSM key", () => {
    const [c] = parseCandidates(response([
      { type: "node", id: 1, lat: 1.3, lon: 103.8, tags: { name: "A", tourism: "museum", "contact:phone": "+65", wikidata: "Q1" } },
    ]), "sg");
    expect(c.tags).toEqual({ tourism: "museum" });
  });

  it("refuses a response that is not an Overpass result at all", () => {
    expect(() => parseCandidates("<html>busy</html>", "sg")).toThrow(/Overpass/);
  });
});

describe("a building's height", () => {
  it("reads metres, tolerating a unit suffix", () => {
    expect(heightOf({ height: "194" })).toBe(194);
    expect(heightOf({ height: "156 m" })).toBe(156);
  });

  it("estimates from storeys when no height is tagged", () => {
    expect(heightOf({ "building:levels": "10" })).toBe(35);
  });

  it("gives up rather than guess", () => {
    expect(heightOf({})).toBeNull();
    expect(heightOf({ height: "tall" })).toBeNull();
  });
});
