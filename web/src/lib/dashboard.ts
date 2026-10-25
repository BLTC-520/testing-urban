/**
 * Where the header's "Command Centre" link points.
 *
 * The command centre (dashboard/ + server/) is a separate app with its own
 * Node API, so this static site can only link to it, never host it. The
 * address is set at build time with VITE_DASHBOARD_URL. With none set, a dev
 * build links to the local dashboard dev server and a production build hides
 * the link, so the public site never sends a visitor to their own localhost.
 */
export const LOCAL_DASHBOARD_URL = "http://localhost:5174/";

export interface DashboardEnv {
  DEV: boolean;
  VITE_DASHBOARD_URL?: string;
}

export function dashboardUrl(env: DashboardEnv): string | null {
  const configured = env.VITE_DASHBOARD_URL?.trim();
  if (!configured) return env.DEV ? LOCAL_DASHBOARD_URL : null;
  // A bad value is a deploy mistake. vite.config.ts calls this too, so it fails the build.
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`VITE_DASHBOARD_URL is not a URL: "${configured}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`VITE_DASHBOARD_URL must be http(s), got "${url.protocol}"`);
  }
  return url.href;
}
