import { useEffect, useState } from "react";

/** Minimal hash router: "#/explore?city=jb" → { path: "/explore", params }. */
export interface Route {
  path: string;
  params: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { path: path || "/", params: new URLSearchParams(query) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(path: string, params?: Record<string, string>): void {
  const q = params ? "?" + new URLSearchParams(params).toString() : "";
  window.location.hash = path + q;
}
