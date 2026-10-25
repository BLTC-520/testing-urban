/**
 * Where the map is allowed to look, as [west, south, east, north] in degrees.
 *
 * STUDY_AREA is the pipeline's acquisition box (config/study_area.yml): both
 * cities and the strait between them with a margin. The camera is kept inside
 * it — nothing outside it has data.
 *
 * CITY_BOUNDS are each city's districts (web/public/data/neighbourhoods.geojson)
 * plus ~1 km. 3D building tiles outside the current city's box are never
 * requested. The boxes are rectangles, so they still overlap across the strait
 * and touch Batam's northern tip; the exact cut to the city is done on the GPU
 * by the hexagon mask in buildings.ts.
 */
import type { CityId } from "../api/types.ts";

export type Bounds = [west: number, south: number, east: number, north: number];

export const STUDY_AREA: Bounds = [103.3, 1.1, 104.3, 1.85];

export const CITY_BOUNDS: Record<CityId, Bounds> = {
  sg: [103.596, 1.149, 104.098, 1.481],
  jb: [103.526, 1.333, 104.038, 1.683],
};
