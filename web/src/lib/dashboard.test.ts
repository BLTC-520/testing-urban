import { describe, expect, it } from "vitest";
import { LOCAL_DASHBOARD_URL, dashboardUrl } from "./dashboard";

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
