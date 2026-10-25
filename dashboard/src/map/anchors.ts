/**
 * Which landmark callouts the camera shows, re-decided as it flies.
 *
 * Ported from snaproom's SemanticLabelRenderer. There, Gemini finds objects in
 * a screenshot of a room and they are raycast into 3D anchors; every few
 * frames a handful are picked to label, by importance, by how central they are
 * on screen and by keeping callouts apart. The selection is what carries over.
 * The detection does not: a city's landmarks have known coordinates, so they
 * come from a catalogue (landmarks.ts) instead of a vision model.
 *
 * Pure functions over a projection, so the rules are testable without a map.
 */

/** Something worth pointing at: a position in [lon, lat, metres] and a rank. */
export interface Anchor {
  id: string;
  position: readonly [lon: number, lat: number, alt: number];
  /** 0–1. How much a viewer would want this named, before any camera context. */
  importance: number;
  /** Zoom below which it is never shown; derived from importance when absent. */
  minZoom?: number;
  /** Always worth the slot: a large boost, not a guarantee. */
  pinned?: boolean;
}

export interface ScreenPoint { x: number; y: number }

/** Lon/lat/alt to container pixels, or null when it cannot be placed. */
export type Project = (position: Anchor["position"]) => ScreenPoint | null;

export interface View { width: number; height: number; zoom: number }

/** The quadrant a callout's label sits in, relative to its point. */
export type Side = "ne" | "nw" | "se" | "sw";

export interface PlacedAnchor<A extends Anchor> extends ScreenPoint {
  anchor: A;
  side: Side;
}

export const MIN_ANCHORS = 2;
export const MAX_ANCHORS = 5;
/** How often the set is re-picked mid-flight; positions update every frame. */
export const RESELECT_MS = 120;
/** Points this far past the edge still count, so a callout does not pop at the border. */
const VIEW_MARGIN = 0.04;
/** Stage pixels between two callout points before they are judged crowded. */
const MIN_SEPARATION = 154;
/**
 * A callout's label, in stage pixels: offset from its point by the leader line,
 * then this big. The component draws with the same numbers; the height is the
 * tallest label (three lines of note plus the access line), so a check against
 * it errs towards spacing labels out.
 */
export const LABEL = { leadX: 56, leadY: 44, width: 214, height: 96 } as const;
/** Clear space kept between two labels. */
const LABEL_GAP = 6;
/** Head start for an anchor already on screen, so near-ties do not flicker. */
const STICKY_BONUS = 0.06;
const PINNED_BONUS = 0.2;
/** Zoom range over which the count grows from MIN to MAX. */
const ZOOM_FEW = 12;
const ZOOM_MANY = 16;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The most important landmarks name themselves from the city view; minor ones wait for a street view. */
export function minZoomFor(anchor: Anchor): number {
  return anchor.minZoom ?? 14 - clamp01(anchor.importance) * 4;
}

/** Few callouts on the whole-city view, more once the camera is low over a district. */
export function targetCount(zoom: number, available: number): number {
  const t = clamp01((zoom - ZOOM_FEW) / (ZOOM_MANY - ZOOM_FEW));
  return Math.min(available, Math.round(MIN_ANCHORS + t * (MAX_ANCHORS - MIN_ANCHORS)));
}

/** Labels point inwards, towards the middle of the screen, so they stay on it. */
export function sideFor(x: number, y: number, view: View): Side {
  const ns = y < view.height / 2 ? "s" : "n";
  const ew = x < view.width / 2 ? "e" : "w";
  return `${ns}${ew}` as Side;
}

interface Candidate<A extends Anchor> extends ScreenPoint { anchor: A; score: number; side: Side }

interface Rect { left: number; top: number; right: number; bottom: number }

/** Where a callout's label lands on screen. */
export function labelRect(x: number, y: number, side: Side): Rect {
  const left = side.endsWith("e") ? x + LABEL.leadX : x - LABEL.leadX - LABEL.width;
  const top = side.startsWith("s") ? y + LABEL.leadY : y - LABEL.leadY - LABEL.height;
  return { left, top, right: left + LABEL.width, bottom: top + LABEL.height };
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right + LABEL_GAP && b.left < a.right + LABEL_GAP
  && a.top < b.bottom + LABEL_GAP && b.top < a.bottom + LABEL_GAP;

const covers = (r: Rect, p: ScreenPoint): boolean =>
  p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

/** Two callouts clash if their points bunch up, their labels touch, or one label hides the other's point. */
function clash(a: Candidate<Anchor>, b: Candidate<Anchor>): boolean {
  if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_SEPARATION) return true;
  const ra = labelRect(a.x, a.y, a.side);
  const rb = labelRect(b.x, b.y, b.side);
  return overlaps(ra, rb) || covers(ra, b) || covers(rb, a);
}

function score(anchor: Anchor, p: ScreenPoint, view: View, sticky: boolean): number {
  const nx = (p.x / view.width - 0.5) * 2;
  const ny = (p.y / view.height - 0.5) * 2;
  // Wider than tall: a landmark at the side of a 16:9 frame is still in view.
  const centrality = clamp01(1 - Math.hypot(nx * 0.82, ny) / 1.25);
  // Under a pitched camera the bottom of the frame is nearer the viewer.
  const nearness = clamp01(p.y / view.height);
  return clamp01(anchor.importance) * 0.6 + centrality * 0.28 + nearness * 0.12
    + (sticky ? STICKY_BONUS : 0) + (anchor.pinned ? PINNED_BONUS : 0);
}

function candidates<A extends Anchor>(
  anchors: readonly A[], project: Project, view: View, current: ReadonlySet<string>,
): Candidate<A>[] {
  const mx = view.width * VIEW_MARGIN;
  const my = view.height * VIEW_MARGIN;
  return anchors
    .flatMap((anchor) => {
      if (view.zoom < minZoomFor(anchor)) return [];
      const p = project(anchor.position);
      if (!p || p.x < -mx || p.x > view.width + mx || p.y < -my || p.y > view.height + my) return [];
      return [{
        anchor, x: p.x, y: p.y, side: sideFor(p.x, p.y, view),
        score: score(anchor, p, view, current.has(anchor.id)),
      }];
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick the callouts for this view, best first.
 *
 * Well-spaced candidates fill the slots first; crowded ones are only used to
 * reach the minimum, so a dense downtown still names something rather than
 * nothing. `current` is the set already on screen, which gets a small head start.
 */
export function selectAnchors<A extends Anchor>(
  anchors: readonly A[],
  project: Project,
  view: View,
  current: ReadonlySet<string> = new Set(),
): PlacedAnchor<A>[] {
  const ranked = candidates(anchors, project, view, current);
  const want = targetCount(view.zoom, ranked.length);
  const crowds = (c: Candidate<A>, picked: readonly Candidate<A>[]) => picked.some((p) => clash(p, c));

  const spaced = ranked.reduce<Candidate<A>[]>(
    (picked, c) => (picked.length < want && !crowds(c, picked) ? [...picked, c] : picked),
    [],
  );
  const fill = ranked
    .filter((c) => !spaced.includes(c))
    .slice(0, Math.max(0, Math.min(MIN_ANCHORS, want) - spaced.length));

  return [...spaced, ...fill].map(({ anchor, x, y, side }) => ({ anchor, x, y, side }));
}
