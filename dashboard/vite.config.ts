import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,          // 5173 belongs to the existing React site
    strictPort: true,
    // The API runs on its own origin in production; in dev we proxy so the
    // browser makes same-origin requests and CORS never enters the picture.
    //
    // /basemap, /fonts and /models are served by the API too (see the
    // @fastify/static registrations in server/src/app.ts) so the 47 MB
    // basemap.pmtiles, the glyph PBFs and the landmark models live in exactly
    // one place in the repository. Without them here, pmtiles' range requests
    // are answered by Vite with index.html and fail as "Wrong magic number for
    // PMTiles archive".
    proxy: Object.fromEntries(
      ["/api", "/basemap", "/fonts", "/models"].map((p) => [
        p,
        { target: "http://127.0.0.1:8787", changeOrigin: true },
      ]),
    ),
  },
  build: { outDir: "dist", sourcemap: true },
});
