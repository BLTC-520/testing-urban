import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerAgentTools } from "./agent/tools";
import App from "./App";
import { loadMeta, loadNeighbourhoods, loadSummary } from "./lib/data";
import "./styles/global.css";

const root = document.getElementById("root")!;

// A prerendered page (see scripts/prerender.mjs) is already readable; fetch the
// data its text is built from before React takes over, so the first render
// matches it instead of flashing a loading state.
const ready = root.hasAttribute("data-prerendered")
  ? Promise.race([Promise.all([loadMeta(), loadSummary(), loadNeighbourhoods()]), new Promise((r) => setTimeout(r, 4000))]).catch(() => null)
  : Promise.resolve();

ready.then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  root.removeAttribute("data-prerendered");
});

registerAgentTools();
