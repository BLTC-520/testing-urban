import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CITY_BOUNDS, STUDY_AREA, type Bounds } from "./studyArea.ts";

type Ring = [number, number][];
interface Feature {
  properties: { city: "sg" | "jb" };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}

// The pipeline's district polygons: Singapore's planning areas, JB's districts.
const districts = (JSON.parse(
  readFileSync(new URL("../../../web/public/data/neighbourhoods.geojson", import.meta.url), "utf8"),
) as { features: Feature[] }).features;

const points = (f: Feature): [number, number][] =>
  (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).flat(2);

const inside = ([lon, lat]: [number, number], [w, s, e, n]: Bounds) => lon >= w && lon <= e && lat >= s && lat <= n;

describe("each city's bounds", () => {
  for (const city of ["sg", "jb"] as const) {
    it(`hold every ${city} district`, () => {
      const pts = districts.filter((f) => f.properties.city === city).flatMap(points);
      expect(pts.length).toBeGreaterThan(100);
      expect(pts.filter((p) => !inside(p, CITY_BOUNDS[city]))).toEqual([]);
    });

    it(`lie within the study area (${city})`, () => {
      const [w, s, e, n] = CITY_BOUNDS[city];
      expect(inside([w, s], STUDY_AREA) && inside([e, n], STUDY_AREA)).toBe(true);
    });
  }
});
