/**
 * Whether this browser can make a WebGL context. MapLibre and deck.gl cannot
 * draw without one, so the map pages use text, stills and tables instead.
 */
let supported: boolean | undefined;

export function hasWebGL(): boolean {
  supported ??= probe();
  return supported;
}

function probe(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return false;
    // release the probe context: browsers limit how many are alive at once
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
