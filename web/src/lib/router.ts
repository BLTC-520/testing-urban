import { useEffect, useState } from "react";

/**
 * Minimal history router. Pages live at real paths ("/", "/explore/",
 * "/methods/", "/about/") so each one is its own prerendered HTML file that
 * crawlers and agents can fetch; query strings carry Explorer state. Old hash
 * links ("#/explore?city=jb") are rewritten to their path form on load.
 */
export interface Route {
  path: string;
  params: URLSearchParams;
}

export const PAGES = ["/", "/explore", "/methods", "/about"] as const;
export type PagePath = (typeof PAGES)[number];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const NAV_EVENT = "sgjb:navigate";

/** "/explore/" or "/explore" (under any base) → "/explore"; "/" stays "/". */
export function normalizePath(pathname: string, base = BASE): string {
  let p = pathname;
  if (base && p.startsWith(base)) p = p.slice(base.length);
  p = p.replace(/\/index\.html$/, "/").replace(/\/+$/, "");
  return p || "/";
}

/** Public URL for a page: "/explore" → "/explore/?city=jb"; an optional in-page anchor. */
export function href(path: string, params?: Record<string, string> | URLSearchParams, anchor?: string): string {
  const q = params ? new URLSearchParams(params).toString() : "";
  const p = path === "/" ? "/" : `${path.replace(/\/+$/, "")}/`;
  return `${BASE}${p}${q ? `?${q}` : ""}${anchor ? `#${anchor}` : ""}`;
}

/** "#/methods?x=1" → "/methods/?x=1"; null when the hash is an ordinary in-page anchor. */
export function legacyHashTarget(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const [path, query = ""] = hash.slice(1).split("?");
  return href(normalizePath(path, ""), new URLSearchParams(query));
}

function parse(): Route {
  return { path: normalizePath(window.location.pathname), params: new URLSearchParams(window.location.search) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => {
    const legacy = legacyHashTarget(window.location.hash);
    if (legacy) window.history.replaceState(null, "", legacy);
    return parse();
  });
  useEffect(() => {
    const on = () => {
      const legacy = legacyHashTarget(window.location.hash);
      if (legacy) window.history.replaceState(null, "", legacy);
      setRoute((prev) => {
        const next = parse();
        return prev.path === next.path && prev.params.toString() === next.params.toString() ? prev : next;
      });
    };
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    window.addEventListener(NAV_EVENT, on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
      window.removeEventListener(NAV_EVENT, on);
    };
  }, []);
  return route;
}

export function navigate(path: string, params?: Record<string, string> | URLSearchParams, anchor?: string): void {
  window.history.pushState(null, "", href(path, params, anchor));
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** Update the query string of the current page without a navigation (Explorer state). */
export function replaceParams(params: URLSearchParams): void {
  const q = params.toString();
  const next = `${window.location.pathname}${q ? `?${q}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
}

/**
 * Same-document navigation for plain <a href="/methods/"> links, so pages
 * keep ordinary, crawlable links while moving between them without a reload.
 */
export function interceptLinks(): () => void {
  const on = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const path = normalizePath(url.pathname);
    if (!(PAGES as readonly string[]).includes(path)) return;
    if (url.hash && path === normalizePath(window.location.pathname)) return; // in-page anchor
    e.preventDefault();
    navigate(path, url.searchParams, url.hash.slice(1) || undefined);
  };
  document.addEventListener("click", on);
  return () => document.removeEventListener("click", on);
}
