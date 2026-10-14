/** Small GeoJSON helpers (no dependencies): bounding boxes and point-in-polygon. */

type Ring = number[][];

function polygons(g: GeoJSON.Geometry | null): Ring[][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  return [];
}

export function bbox(f: GeoJSON.Feature): [[number, number], [number, number]] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const poly of polygons(f.geometry))
    for (const [x, y] of poly[0] ?? []) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return [
    [x0, y0],
    [x1, y1],
  ];
}

function inRing(r: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(f: GeoJSON.Feature, lon: number, lat: number): boolean {
  return polygons(f.geometry).some((poly) => poly.length > 0 && inRing(poly[0], lon, lat) && !poly.slice(1).some((hole) => inRing(hole, lon, lat)));
}

/** The neighbourhood (planning area / state constituency) containing a point, if any. */
export function unitAt(fc: GeoJSON.FeatureCollection, lon: number, lat: number): GeoJSON.Feature | null {
  return fc.features.find((f) => contains(f, lon, lat)) ?? null;
}
