import { describe, expect, it } from "vitest";
import {
  MAX_ANCHORS, MIN_ANCHORS, type Anchor, type Project, minZoomFor, selectAnchors, sideFor, targetCount,
} from "./anchors.ts";

const VIEW = { width: 1000, height: 600, zoom: 15 };

/** A flat test projection: lon/lat are already screen pixels. */
const flat: Project = ([x, y]) => ({ x, y });

const anchor = (id: string, x: number, y: number, importance = 0.8, extra: Partial<Anchor> = {}): Anchor => ({
  id, position: [x, y, 0], importance, ...extra,
});

describe("how many anchors a view shows", () => {
  it("shows the minimum zoomed out and the maximum zoomed right in", () => {
    expect(targetCount(10, 20)).toBe(MIN_ANCHORS);
    expect(targetCount(16, 20)).toBe(MAX_ANCHORS);
  });

  it("never asks for more anchors than there are", () => {
    expect(targetCount(16, 1)).toBe(1);
    expect(targetCount(16, 0)).toBe(0);
  });
});

describe("when an anchor appears", () => {
  it("brings important landmarks in earlier than minor ones", () => {
    expect(minZoomFor(anchor("a", 0, 0, 1))).toBeLessThan(minZoomFor(anchor("b", 0, 0, 0.4)));
  });

  it("honours an explicit zoom floor", () => {
    expect(minZoomFor(anchor("a", 0, 0, 1, { minZoom: 14 }))).toBe(14);
  });
});

describe("which anchors a view selects", () => {
  it("drops anchors that are off screen or not yet zoomed in to", () => {
    const picked = selectAnchors(
      [anchor("in", 500, 300), anchor("off", 2000, 300), anchor("far", 400, 200, 0.8, { minZoom: 17 })],
      flat, VIEW,
    );
    expect(picked.map((p) => p.anchor.id)).toEqual(["in"]);
  });

  it("drops anchors the projection cannot place", () => {
    const behind: Project = ([x]) => (x < 0 ? null : { x: 500, y: 300 });
    expect(selectAnchors([anchor("gone", -1, 0)], behind, VIEW)).toEqual([]);
  });

  it("ranks importance first, then closeness to the centre", () => {
    const picked = selectAnchors(
      [anchor("edge-minor", 50, 550, 0.4), anchor("centre-major", 500, 300, 0.95), anchor("edge-major", 900, 80, 0.95)],
      flat, VIEW,
    );
    expect(picked.map((p) => p.anchor.id)).toEqual(["centre-major", "edge-major", "edge-minor"]);
  });

  it("keeps callouts apart, filling up to the minimum before allowing a crowd", () => {
    const crowd = [anchor("a", 500, 300, 0.9), anchor("b", 510, 305, 0.85), anchor("c", 520, 310, 0.8)];
    const picked = selectAnchors(crowd, flat, { ...VIEW, zoom: 12 });
    expect(picked).toHaveLength(MIN_ANCHORS);
    expect(picked.map((p) => p.anchor.id)).toEqual(["a", "b"]);
  });

  it("prefers a well-spaced anchor over a crowded one of equal rank", () => {
    const picked = selectAnchors(
      [anchor("a", 500, 300, 0.9), anchor("near-a", 520, 300, 0.85), anchor("apart", 200, 520, 0.8)],
      flat, { ...VIEW, zoom: 12 },
    );
    expect(picked.map((p) => p.anchor.id)).toEqual(["a", "apart"]);
  });

  it("treats a point under another callout's label as crowded, however far apart the points are", () => {
    // "a" is top-left, so its label hangs down and right; "b" sits under that label.
    const picked = selectAnchors(
      [anchor("a", 300, 150, 1), anchor("b", 300 + 56 + 150, 150 + 44 + 40, 0.5), anchor("c", 800, 450, 0.5)],
      flat, { ...VIEW, zoom: 12 },
    );
    expect(picked.map((p) => p.anchor.id)).toEqual(["a", "c"]);
  });

  it("keeps what is already shown when a newcomer only just outranks it", () => {
    const pair = [anchor("old", 300, 300, 0.80), anchor("new", 700, 300, 0.82)];
    const crowd = { ...VIEW, zoom: 12 };
    // Only one slot left after a fixed, far more important anchor.
    const top = anchor("top", 500, 300, 1);
    const fresh = selectAnchors([top, ...pair, anchor("x", 100, 500, 0.1)], flat, crowd);
    expect(fresh.map((p) => p.anchor.id)).toEqual(["top", "new"]);
    const sticky = selectAnchors([top, ...pair], flat, crowd, new Set(["old"]));
    expect(sticky.map((p) => p.anchor.id)).toEqual(["top", "old"]);
  });

  it("does not modify the anchors it is given", () => {
    const list = Object.freeze([anchor("a", 500, 300)]);
    expect(() => selectAnchors(list, flat, VIEW)).not.toThrow();
  });
});

describe("which way a callout points", () => {
  it("points inwards so the label stays on screen", () => {
    expect(sideFor(100, 100, VIEW)).toBe("se");
    expect(sideFor(900, 100, VIEW)).toBe("sw");
    expect(sideFor(100, 500, VIEW)).toBe("ne");
    expect(sideFor(900, 500, VIEW)).toBe("nw");
  });
});
