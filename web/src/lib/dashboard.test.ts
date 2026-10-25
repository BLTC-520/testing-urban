import { describe, expect, it } from "vitest";
import { LOCAL_DASHBOARD_URL, dashboardSceneUrl, dashboardUrl } from "./dashboard";

describe("command centre link", () => {
  it("uses the configured address when one is set", () => {
    expect(dashboardUrl({ DEV: false, VITE_DASHBOARD_URL: "https://cc.example.org/" })).toBe("https://cc.example.org/");
    expect(dashboardUrl({ DEV: true, VITE_DASHBOARD_URL: "https://cc.example.org/" })).toBe("https://cc.example.org/");
  });

  it("falls back to the local dev server only in development", () => {
    expect(dashboardUrl({ DEV: true })).toBe(LOCAL_DASHBOARD_URL);
    expect(dashboardUrl({ DEV: true, VITE_DASHBOARD_URL: "  " })).toBe(LOCAL_DASHBOARD_URL);
  });

  it("hides the link on a production build with no address, rather than pointing at localhost", () => {
    expect(dashboardUrl({ DEV: false })).toBeNull();
    expect(dashboardUrl({ DEV: false, VITE_DASHBOARD_URL: "" })).toBeNull();
  });

  it("refuses anything that is not an http(s) URL", () => {
    expect(() => dashboardUrl({ DEV: false, VITE_DASHBOARD_URL: "javascript:alert(1)" })).toThrow(/VITE_DASHBOARD_URL/);
    expect(() => dashboardUrl({ DEV: false, VITE_DASHBOARD_URL: "cc.example.org" })).toThrow(/VITE_DASHBOARD_URL/);
  });
});

describe("command centre scene link", () => {
  it("appends query parameters cleanly to configured url", () => {
    expect(
      dashboardSceneUrl(
        { DEV: false, VITE_DASHBOARD_URL: "https://cc.example.org/" },
        { city: "jb", landmark: "larkin", buildings: true }
      )
    ).toBe("https://cc.example.org/?city=jb&landmark=larkin&buildings=1");

    expect(
      dashboardSceneUrl(
        { DEV: false, VITE_DASHBOARD_URL: "https://cc.example.org/" },
        { city: "sg", landmark: "mbs", buildings: true }
      )
    ).toBe("https://cc.example.org/?city=sg&landmark=mbs&buildings=1");
  });

  it("falls back to dev server with params when unconfigured in dev", () => {
    expect(
      dashboardSceneUrl(
        { DEV: true },
        { city: "jb", landmark: "ciq", scenario: "p2p25", buildings: false }
      )
    ).toBe(`${LOCAL_DASHBOARD_URL}?city=jb&landmark=ciq&scenario=p2p25&buildings=0`);
  });

  it("returns null in production when unconfigured", () => {
    expect(
      dashboardSceneUrl(
        { DEV: false },
        { city: "sg", landmark: "sgh", buildings: true }
      )
    ).toBeNull();
  });

  it("returns base url when params are omitted", () => {
    expect(dashboardSceneUrl({ DEV: true })).toBe(LOCAL_DASHBOARD_URL);
    expect(
      dashboardSceneUrl({ DEV: false, VITE_DASHBOARD_URL: "https://cc.example.org/" })
    ).toBe("https://cc.example.org/");
  });
});
