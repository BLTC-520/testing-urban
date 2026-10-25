/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cesium ion access token for 3D buildings; unset hides them. See src/map/buildings.ts. */
  readonly VITE_CESIUM_ION_TOKEN?: string;
}
