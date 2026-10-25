import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { dashboardUrl } from "./src/lib/dashboard.ts";

// Pages are served at real paths (/, /explore/, /methods/), so assets need an absolute base.
// Deploying under a sub-path (e.g. username.github.io/repo/) → BASE_PATH=/repo/ npm run build:site
export default defineConfig(({ mode }) => {
  // Validate the Command Centre address here so a typo fails the build, not the live page.
  dashboardUrl({ DEV: false, VITE_DASHBOARD_URL: loadEnv(mode, process.cwd(), "VITE_").VITE_DASHBOARD_URL });
  return {
    base: process.env.BASE_PATH ?? "/",
    plugins: [react()],
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 2500,
    },
  };
});
