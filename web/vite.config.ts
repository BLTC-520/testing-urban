import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Pages are served at real paths (/, /explore/, /methods/), so assets need an absolute base.
// Deploying under a sub-path (e.g. username.github.io/repo/) → BASE_PATH=/repo/ npm run build:site
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2500,
  },
});
