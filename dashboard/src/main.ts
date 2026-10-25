/**
 * Entry point.
 *
 * React equivalent: createRoot(el).render(<Provider><App/></Provider>).
 * `createPinia()` is the store provider; Vue has no JSX here because the
 * template lives in App.vue.
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/global.css";
import "maplibre-gl/dist/maplibre-gl.css";

createApp(App).use(createPinia()).mount("#app");
