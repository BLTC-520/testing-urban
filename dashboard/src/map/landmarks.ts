/**
 * Notable places the camera names as it passes them: a hand-written list,
 * merged with the one Gemini picks from OpenStreetMap (landmarks.generated.json,
 * written by `npm run landmarks`; see scripts/landmarks).
 *
 * The hand-written list always wins. It holds places OSM's notability filter
 * misses (NAFA and Woodlands Checkpoint carry no Wikidata tag) and the
 * Causeway pair, whose importance should not depend on a model run.
 *
 * Coordinates are OpenStreetMap's (Nominatim, October 2026), each a point on
 * the building. `height` is roughly the roof in metres, so the callout sits on
 * top of the Cesium building rather than at its foot. Approximate, not surveyed.
 *
 * `importance` plays the part Gemini's score plays in snaproom: how much a
 * viewer of a SG/JB access dashboard would want the place named. Crossings and
 * hospitals rank higher than their fame alone would put them, because they are
 * what the access measure is about.
 */
import type { CityId } from "../api/types.ts";
import { isLandmark, type Landmark, type LandmarkKind } from "./landmarkTypes.ts";
import generated from "./landmarks.generated.json";

export type { Landmark, LandmarkKind } from "./landmarkTypes.ts";

/**
 * Two landmarks closer than this are one place under two names. Measured on
 * the first Gemini run: true duplicates of hand-written entries sat 0–80 m
 * away, genuine neighbours (Parliament House beside the National Gallery, the
 * National Library beside UAS) 150 m or more.
 */
const SAME_PLACE_M = 100;

type Row = [id: string, name: string, city: CityId, kind: LandmarkKind, lat: number, lon: number, height: number, importance: number, note: string];

const ROWS: readonly Row[] = [
  ["mbs", "Marina Bay Sands", "sg", "icon", 1.28370, 103.86072, 200, 1, "Three towers under a 340 m SkyPark, on reclaimed land"],
  ["gardens", "Gardens by the Bay", "sg", "leisure", 1.28115, 103.86496, 50, 0.82, "101 ha of reclaimed waterfront; the Supertrees reach 50 m"],
  ["flyer", "Singapore Flyer", "sg", "icon", 1.28944, 103.86326, 165, 0.7, "165 m observation wheel at Marina Centre"],
  ["esplanade", "Esplanade", "sg", "culture", 1.28964, 103.85595, 40, 0.72, "Theatres on the Bay, the twin 'durian' domes"],
  ["merlion", "Merlion Park", "sg", "icon", 1.28569, 103.85416, 10, 0.6, "The Merlion, facing the mouth of the Singapore River"],
  ["gallery", "National Gallery", "sg", "culture", 1.29026, 103.85147, 30, 0.68, "Former Supreme Court and City Hall, joined in 2015"],
  ["raffles", "Raffles Hotel", "sg", "icon", 1.29468, 103.85464, 25, 0.62, "Colonial hotel on Beach Road, opened 1887"],
  ["nafa", "NAFA Campus 1", "sg", "education", 1.29974, 103.85142, 30, 0.66, "Nanyang Academy of Fine Arts, Bencoolen Street"],
  ["uas", "University of the Arts", "sg", "education", 1.29873, 103.85343, 30, 0.58, "UAS, the NAFA and LASALLE federation, Middle Road"],
  ["guoco", "Guoco Tower", "sg", "icon", 1.27705, 103.84547, 290, 0.74, "Singapore's tallest building, 290 m, over Tanjong Pagar MRT"],
  ["pinnacle", "Pinnacle@Duxton", "sg", "civic", 1.27677, 103.84132, 156, 0.7, "Public housing: seven 50-storey HDB blocks, sky bridges at 26 and 50"],
  ["sgh", "Singapore General Hospital", "sg", "health", 1.27973, 103.83464, 60, 0.74, "The country's largest and oldest hospital, Outram"],
  ["stadium", "National Stadium", "sg", "leisure", 1.30449, 103.87434, 80, 0.6, "Sports Hub, with a retractable dome roof"],
  ["jewel", "Jewel Changi", "sg", "transport", 1.36022, 103.98967, 40, 0.76, "Airport hub with the 40 m Rain Vortex"],
  ["woodlands", "Woodlands Checkpoint", "sg", "transport", 1.44596, 103.76857, 30, 0.9, "Singapore end of the Causeway, one of the world's busiest land crossings"],
  ["ciq", "Bangunan Sultan Iskandar", "jb", "transport", 1.46500, 103.76673, 40, 0.9, "JB's Causeway customs and immigration complex"],
  ["citysquare", "Johor Bahru City Square", "jb", "retail", 1.46169, 103.76400, 150, 0.7, "Mall and office tower at the Causeway's landfall"],
  ["komtar", "Komtar JBCC", "jb", "retail", 1.46373, 103.76260, 100, 0.6, "Redeveloped Komtar tower and mall, Jalan Wong Ah Fook"],
  ["mosque", "Sultan Abu Bakar Mosque", "jb", "culture", 1.45685, 103.75128, 40, 0.74, "State mosque from 1900, overlooking the Strait of Johor"],
  ["istana", "Istana Besar", "jb", "civic", 1.45505, 103.75629, 20, 0.62, "Royal palace of the Sultan of Johor, built 1866"],
  ["aminah", "Hospital Sultanah Aminah", "jb", "health", 1.46008, 103.74690, 40, 0.74, "Johor's main public general hospital"],
  ["southkey", "Mid Valley Southkey", "jb", "retail", 1.50170, 103.77732, 150, 0.56, "Mall and towers in the Kota Southkey development"],
  ["legoland", "Legoland Malaysia", "jb", "leisure", 1.42777, 103.62948, 20, 0.58, "Theme park in Medini, Iskandar Puteri"],
];

export const CURATED: readonly Landmark[] = ROWS.map(
  ([id, name, city, kind, lat, lon, height, importance, note]) => ({
    id, name, city, kind, note, importance, position: [lon, lat, height] as const,
  }),
);

/** Ground distance in metres; flat-earth is plenty at the scale of a city. */
function metresBetween(a: Landmark, b: Landmark): number {
  const [lon1, lat1] = a.position;
  const [lon2, lat2] = b.position;
  const kx = 111_320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110_574);
}

/**
 * Every curated landmark, then the generated ones that stand on their own:
 * most important first, each dropped if it is within SAME_PLACE_M of one
 * already kept. Generated entries are checked, since they come from a file.
 */
export function mergeLandmarks(curated: readonly Landmark[], generatedRows: readonly unknown[]): Landmark[] {
  const extra = generatedRows
    .filter(isLandmark)
    .sort((a, b) => b.importance - a.importance); // filter() already made a copy
  return extra.reduce<Landmark[]>(
    (kept, l) => (kept.some((k) => metresBetween(k, l) < SAME_PLACE_M) ? kept : [...kept, l]),
    [...curated],
  );
}

export const LANDMARKS: readonly Landmark[] = mergeLandmarks(CURATED, generated.landmarks);

export type LandmarkSort = "importance" | "name" | "kind";

/**
 * Landmarks for one city, deduplicated by id, case-insensitive name and
 * ground proximity, then ordered for the dashboard's Landmarks list without
 * mutating the input array.
 */
export function listLandmarks(
  city: CityId,
  sort: LandmarkSort = "importance",
  source: readonly Landmark[] = LANDMARKS,
): Landmark[] {
  const byRank = source
    .filter((l) => l.city === city)
    .sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const deduped = byRank.reduce<Landmark[]>((kept, l) => {
    const key = l.name.trim().toLowerCase();
    if (seenIds.has(l.id) || seenNames.has(key) || kept.some((k) => metresBetween(k, l) < SAME_PLACE_M)) {
      return kept;
    }
    seenIds.add(l.id);
    seenNames.add(key);
    return [...kept, l];
  }, []);
  if (sort === "name") return [...deduped].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "kind") {
    return [...deduped].sort(
      (a, b) => a.kind.localeCompare(b.kind) || b.importance - a.importance || a.name.localeCompare(b.name),
    );
  }
  return deduped;
}
