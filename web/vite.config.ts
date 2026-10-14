import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the static build works from any path (GitHub Pages, Netlify, a local folder).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2500,
  },
});
