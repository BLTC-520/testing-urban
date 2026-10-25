/**
 * The landmark shape, shared by the map and by the build-time script that
 * generates landmarks.generated.json (scripts/landmarks). Kept apart from
 * landmarks.ts so the script can import it without importing the JSON it writes.
 */
import type { CityId } from "../api/types.ts";
import type { Anchor } from "./anchors.ts";

export const LANDMARK_KINDS = ["icon", "culture", "education", "transport", "health", "civic", "retail", "leisure"] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export interface Landmark extends Anchor {
  name: string;
  city: CityId;
  kind: LandmarkKind;
  /** One line, shown under the name. */
  note: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Narrows untrusted data (a JSON file, a model's answer) to a Landmark. */
export function isLandmark(v: unknown): v is Landmark {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  const p = l.position;
  return isText(l.id) && isText(l.name) && isText(l.note)
    && (l.city === "sg" || l.city === "jb")
    && (LANDMARK_KINDS as readonly unknown[]).includes(l.kind)
    && isNum(l.importance) && l.importance >= 0 && l.importance <= 1
    && Array.isArray(p) && p.length === 3 && p.every(isNum)
    && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90 && p[2] >= 0;
}
