import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, paramsFromView, viewFromParams } from "./explorerUrl";
import { href, legacyHashTarget, normalizePath } from "./router";

describe("router paths", () => {
  it("normalises trailing slashes, index.html and a base path", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/explore/")).toBe("/explore");
    expect(normalizePath("/methods/index.html")).toBe("/methods");
    expect(normalizePath("/repo/methods/", "/repo")).toBe("/methods");
    expect(normalizePath("/repo/", "/repo")).toBe("/");
  });

  it("builds page URLs with a trailing slash, query and anchor", () => {
    expect(href("/")).toBe("/");
    expect(href("/explore", { metric: "healthcare" })).toBe("/explore/?metric=healthcare");
    expect(href("/methods", undefined, "metrics")).toBe("/methods/#metrics");
  });

  it("rewrites old hash routes but leaves in-page anchors alone", () => {
    expect(legacyHashTarget("#/methods")).toBe("/methods/");
    expect(legacyHashTarget("#/explore?city=jb&lon=103.7&lat=1.5")).toBe("/explore/?city=jb&lon=103.7&lat=1.5");
    expect(legacyHashTarget("#/")).toBe("/");
    expect(legacyHashTarget("#why")).toBeNull();
    expect(legacyHashTarget("")).toBeNull();
  });
});

describe("explorer URL state", () => {
  it("writes nothing for the baseline view", () => {
    expect(paramsFromView(DEFAULT_VIEW).toString()).toBe("");
    expect(viewFromParams(new URLSearchParams())).toEqual(DEFAULT_VIEW);
  });

  it("round-trips a full view", () => {
    const v = { ...DEFAULT_VIEW, metric: "healthcare" as const, threshold: 10, speed: "slow" as const, people: "elderly" as const, scenario: "p2p25" as const, selection: { lon: 103.76463, lat: 1.46297, city: "jb" as const } };
    const p = paramsFromView(v);
    expect(p.toString()).toBe("metric=healthcare&minutes=10&speed=slow&people=elderly&scenario=p2p25&lon=103.76463&lat=1.46297&city=jb");
    expect(viewFromParams(p)).toEqual(v);
  });

  it("falls back to the baseline for invalid values", () => {
    const v = viewFromParams(new URLSearchParams("metric=cinemas&minutes=7&speed=sprint&people=kids&scenario=p2p99&lon=abc&lat=1.3"));
    expect(v).toEqual(DEFAULT_VIEW);
  });

  it("honours one alternative assumption at a time, like the UI", () => {
    const v = viewFromParams(new URLSearchParams("network=strict&poi=overture"));
    expect(v.network).toBe("strict");
    expect(v.poiSource).toBe("osm");
    expect(viewFromParams(new URLSearchParams("taxonomy=broad&network=strict")).network).toBe("permissive");
  });

  it("keeps a point without a city for later inference", () => {
    expect(viewFromParams(new URLSearchParams("lon=103.85&lat=1.29")).selection).toEqual({ lon: 103.85, lat: 1.29, city: null });
  });
});
