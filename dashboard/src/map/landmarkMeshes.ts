/**
 * 100% open-source 3D Landmark Multi-Part Meshes & Semantic Colors.
 *
 * Provides recognizable architectural footprints and multi-tiered volumetric
 * forms for landmarks across Singapore and Johor Bahru using deck.gl's PolygonLayer,
 * fully independent of proprietary 3D tiles.
 */
import { PolygonLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import { LANDMARKS } from "./landmarks.ts";
import type { Landmark, LandmarkKind } from "./landmarkTypes.ts";

/**
 * Vivid, distinct semantic colors for landmark kinds so categories
 * stand out immediately in 3D against the dark survey basemap.
 */
export const KIND_RGB: Readonly<Record<LandmarkKind, [number, number, number]>> = Object.freeze({
  icon: [56, 217, 214],       // Electric Cyan-Teal
  transport: [176, 128, 240], // Transit Violet
  health: [235, 88, 124],     // Healthcare Rose
  education: [98, 148, 245],  // Education Blue
  leisure: [52, 199, 116],    // Emerald Green
  retail: [240, 158, 54],     // Retail Warm Amber
  culture: [244, 132, 95],    // Heritage Coral
  civic: [142, 198, 230],     // Civic Sky Blue
});

export interface LandmarkMeshPart {
  id: string;
  landmarkId: string;
  landmark: Landmark;
  partName: string;
  /** Closed polygon ring of [lon, lat] coordinates */
  polygon: [number, number][];
  heightM: number;
  color: [number, number, number];
  wireframeColor: [number, number, number];
}

const DEG2RAD = Math.PI / 180;

/** Converts metre offsets dx, dy from an origin [lon, lat] into [lon, lat], with optional rotation. */
export function offsetMetres(
  originLon: number,
  originLat: number,
  dxM: number,
  dyM: number,
  rotationDeg = 0,
): [number, number] {
  const kx = 111_320 * Math.cos(originLat * DEG2RAD);
  const ky = 110_574;
  let rx = dxM;
  let ry = dyM;
  if (rotationDeg !== 0) {
    const rad = rotationDeg * DEG2RAD;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    rx = dxM * cos - dyM * sin;
    ry = dxM * sin + dyM * cos;
  }
  return [originLon + rx / kx, originLat + ry / ky];
}

/** Builds a closed rectangular polygon centered at (centerDxM, centerDyM) with rotation. */
export function createBox(
  originLon: number,
  originLat: number,
  widthM: number,
  lengthM: number,
  centerDxM = 0,
  centerDyM = 0,
  rotationDeg = 0,
): [number, number][] {
  const hw = widthM / 2;
  const hl = lengthM / 2;
  const corners: [number, number][] = [
    [centerDxM - hw, centerDyM - hl],
    [centerDxM + hw, centerDyM - hl],
    [centerDxM + hw, centerDyM + hl],
    [centerDxM - hw, centerDyM + hl],
  ];
  const ring = corners.map(([x, y]) => offsetMetres(originLon, originLat, x, y, rotationDeg));
  ring.push(ring[0]);
  return ring;
}

/** Builds a closed regular polygon (e.g. octagon, hexagon) around a center offset. */
export function createRegularPolygon(
  originLon: number,
  originLat: number,
  radiusM: number,
  sides = 8,
  centerDxM = 0,
  centerDyM = 0,
  rotationDeg = 0,
): [number, number][] {
  const ring: [number, number][] = [];
  const step = (Math.PI * 2) / sides;
  for (let i = 0; i < sides; i++) {
    const angle = i * step;
    const x = centerDxM + radiusM * Math.cos(angle);
    const y = centerDyM + radiusM * Math.sin(angle);
    ring.push(offsetMetres(originLon, originLat, x, y, rotationDeg));
  }
  ring.push(ring[0]);
  return ring;
}

/** Builds a closed elliptical polygon for curved architectural volumes and domes. */
export function createEllipsePolygon(
  originLon: number,
  originLat: number,
  radiusXM: number,
  radiusYM: number,
  sides = 16,
  centerDxM = 0,
  centerDyM = 0,
  rotationDeg = 0,
): [number, number][] {
  const ring: [number, number][] = [];
  const step = (Math.PI * 2) / sides;
  for (let i = 0; i < sides; i++) {
    const angle = i * step;
    const x = centerDxM + radiusXM * Math.cos(angle);
    const y = centerDyM + radiusYM * Math.sin(angle);
    ring.push(offsetMetres(originLon, originLat, x, y, rotationDeg));
  }
  ring.push(ring[0]);
  return ring;
}

/** Brightens or shifts an RGB triple for roof crowns, highlights, and wireframes. */
export function brighten(
  rgb: [number, number, number],
  factor = 1.25,
  add = 0,
): [number, number, number] {
  return [
    Math.min(255, Math.max(0, Math.round(rgb[0] * factor + add))),
    Math.min(255, Math.max(0, Math.round(rgb[1] * factor + add))),
    Math.min(255, Math.max(0, Math.round(rgb[2] * factor + add))),
  ];
}

function buildMbsMeshes(landmark: Landmark): LandmarkMeshPart[] {
  const [lon, lat] = landmark.position;
  const kindRgb = KIND_RGB[landmark.kind];
  const parts: LandmarkMeshPart[] = [];

  // Three hotel tower slabs (height 195m, ~85m x 26m, rotated -25°, spaced along crescent)
  const towers = [
    { id: "mbs-tower-1", name: "Tower 1", dx: -95 },
    { id: "mbs-tower-2", name: "Tower 2", dx: 0 },
    { id: "mbs-tower-3", name: "Tower 3", dx: 95 },
  ];
  for (const t of towers) {
    parts.push({
      id: t.id,
      landmarkId: landmark.id,
      landmark,
      partName: t.name,
      polygon: createBox(lon, lat, 26, 85, t.dx, 0, -25),
      heightM: 195,
      color: kindRgb,
      wireframeColor: brighten(kindRgb, 1.25),
    });
  }

  // Iconic SkyPark Ship Deck (height 205m, sleek 340m x 38m boat hull bridging the towers)
  const boatPoints: [number, number][] = [
    [-135, -19],
    [155, -19],
    [205, 0],   // Tapered cantilever bow tip
    [155, 19],
    [-135, 19],
  ];
  const skyparkPolygon = boatPoints.map(([x, y]) => offsetMetres(lon, lat, x, y, -25));
  skyparkPolygon.push(skyparkPolygon[0]);

  parts.push({
    id: "mbs-skypark",
    landmarkId: landmark.id,
    landmark,
    partName: "SkyPark Ship Deck",
    polygon: skyparkPolygon,
    heightM: 205,
    color: [255, 209, 102], // Bright iconic gold
    wireframeColor: [255, 240, 160],
  });

  // The Shoppes & Convention Podium (height 32m along the waterfront)
  parts.push({
    id: "mbs-shoppes",
    landmarkId: landmark.id,
    landmark,
    partName: "The Shoppes & Convention Podium",
    polygon: createBox(lon, lat, 280, 65, 0, 55, -25),
    heightM: 32,
    color: [45, 180, 180],
    wireframeColor: brighten([45, 180, 180], 1.25),
  });

  // ArtScience Museum Lotus (height 48m octagonal lotus form)
  parts.push({
    id: "mbs-artscience",
    landmarkId: landmark.id,
    landmark,
    partName: "ArtScience Museum Lotus",
    polygon: createRegularPolygon(103.85926, 1.28606, 32, 8),
    heightM: 48,
    color: [220, 245, 250],
    wireframeColor: [255, 255, 255],
  });

  return parts;
}

function buildLarkinMeshes(landmark: Landmark): LandmarkMeshPart[] {
  const [lon, lat] = landmark.position;
  const transitRgb = KIND_RGB.transport;

  return [
    {
      id: "larkin-concourse",
      landmarkId: landmark.id,
      landmark,
      partName: "Main Terminal Concourse & Market Hall",
      polygon: createBox(lon, lat, 130, 75, 0, 0, 0),
      heightM: 24,
      color: transitRgb,
      wireframeColor: brighten(transitRgb, 1.25),
    },
    {
      id: "larkin-north-bay",
      landmarkId: landmark.id,
      landmark,
      partName: "North Express Bus Bay Canopy",
      polygon: createBox(lon, lat, 110, 36, 0, 55, 0),
      heightM: 14,
      color: [195, 155, 245],
      wireframeColor: brighten([195, 155, 245], 1.25),
    },
    {
      id: "larkin-east-bay",
      landmarkId: landmark.id,
      landmark,
      partName: "East Express Bus Bay Canopy",
      polygon: createBox(lon, lat, 38, 75, 84, -5, 0),
      heightM: 14,
      color: [195, 155, 245],
      wireframeColor: brighten([195, 155, 245], 1.25),
    },
    {
      id: "larkin-crown",
      landmarkId: landmark.id,
      landmark,
      partName: "Central Terminal Tower Crown",
      polygon: createBox(lon, lat, 36, 36, 0, 0, 0),
      heightM: 34,
      color: [240, 175, 75], // Amber-violet crown accent
      wireframeColor: [255, 220, 120],
    },
  ];
}

function buildGardensMeshes(landmark: Landmark): LandmarkMeshPart[] {
  const [lon, lat] = landmark.position;
  const leisureRgb = KIND_RGB.leisure;

  const parts: LandmarkMeshPart[] = [
    {
      id: "gardens-flower-dome",
      landmarkId: landmark.id,
      landmark,
      partName: "Flower Dome",
      polygon: createEllipsePolygon(lon, lat, 65, 42, 16, -60, -45, 30),
      heightM: 38,
      color: [70, 205, 185],
      wireframeColor: brighten([70, 205, 185], 1.25),
    },
    {
      id: "gardens-cloud-forest",
      landmarkId: landmark.id,
      landmark,
      partName: "Cloud Forest",
      polygon: createEllipsePolygon(lon, lat, 52, 35, 16, -25, 35, 15),
      heightM: 58,
      color: [60, 220, 160],
      wireframeColor: brighten([60, 220, 160], 1.25),
    },
  ];

  // 6 Supertree Grove Towers (height 38m - 50m octagonal pillars)
  const trees = [
    { dx: 35, dy: 15, h: 50, name: "Supertree 1" },
    { dx: 65, dy: 30, h: 42, name: "Supertree 2" },
    { dx: 85, dy: -5, h: 45, name: "Supertree 3" },
    { dx: 60, dy: -40, h: 38, name: "Supertree 4" },
    { dx: 25, dy: -30, h: 48, name: "Supertree 5" },
    { dx: 50, dy: -5, h: 50, name: "Central Supertree" },
  ];
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    parts.push({
      id: `gardens-supertree-${i + 1}`,
      landmarkId: landmark.id,
      landmark,
      partName: t.name,
      polygon: createRegularPolygon(lon, lat, 11, 8, t.dx, t.dy),
      heightM: t.h,
      color: leisureRgb,
      wireframeColor: [245, 200, 70], // Gold crown ring
    });
  }

  return parts;
}

function buildEsplanadeMeshes(landmark: Landmark): LandmarkMeshPart[] {
  const [lon, lat] = landmark.position;
  const cultureRgb = KIND_RGB.culture;

  return [
    {
      id: "esplanade-concert-hall",
      landmarkId: landmark.id,
      landmark,
      partName: "Concert Hall Durian Dome",
      polygon: createRegularPolygon(lon, lat, 38, 8, -45, 0, 15),
      heightM: 42,
      color: cultureRgb,
      wireframeColor: [255, 190, 150],
    },
    {
      id: "esplanade-theatre",
      landmarkId: landmark.id,
      landmark,
      partName: "Theatre Durian Dome",
      polygon: createRegularPolygon(lon, lat, 38, 8, 45, 0, 15),
      heightM: 42,
      color: cultureRgb,
      wireframeColor: [255, 190, 150],
    },
    {
      id: "esplanade-podium",
      landmarkId: landmark.id,
      landmark,
      partName: "Waterfront Stage Podium",
      polygon: createBox(lon, lat, 120, 50, 0, -42, 0),
      heightM: 18,
      color: [210, 105, 80],
      wireframeColor: brighten([210, 105, 80], 1.25),
    },
  ];
}

function buildPinnacleMeshes(landmark: Landmark): LandmarkMeshPart[] {
  const [lon, lat] = landmark.position;
  const civicRgb = KIND_RGB.civic;
  const parts: LandmarkMeshPart[] = [];

  // 7 residential tower blocks along a gentle curve
  const blocks = [
    { name: "Block 1A", dx: -110, dy: -22 },
    { name: "Block 1B", dx: -75, dy: -6 },
    { name: "Block 1C", dx: -40, dy: 10 },
    { name: "Block 1D", dx: 0, dy: 18 },
    { name: "Block 1E", dx: 40, dy: 12 },
    { name: "Block 1F", dx: 75, dy: -2 },
    { name: "Block 1G", dx: 110, dy: -22 },
  ];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    parts.push({
      id: `pinnacle-tower-${i + 1}`,
      landmarkId: landmark.id,
      landmark,
      partName: b.name,
      polygon: createBox(lon, lat, 32, 22, b.dx, b.dy, 12),
      heightM: 156,
      color: civicRgb,
      wireframeColor: brighten(civicRgb, 1.25),
    });
  }

  // Connecting 50th-Floor Skybridge (height 158m in gold/cyan accent)
  parts.push({
    id: "pinnacle-skybridge",
    landmarkId: landmark.id,
    landmark,
    partName: "50th-Floor Skybridge",
    polygon: createBox(lon, lat, 230, 14, 0, -2, 0),
    heightM: 158,
    color: [255, 209, 102],
    wireframeColor: [255, 235, 150],
  });

  return parts;
}

function buildCheckpointMeshes(landmark: Landmark, isCiq: boolean): LandmarkMeshPart[] {
  const [lon, lat] = landmark.position;
  const transportRgb = KIND_RGB.transport;
  const prefix = isCiq ? "ciq" : "woodlands";
  const hallDim: [number, number] = isCiq ? [140, 80] : [130, 75];
  const viaductDim: [number, number] = isCiq ? [180, 45] : [160, 40];
  const viaductDy = isCiq ? -50 : 45;
  const towerDx = isCiq ? 30 : -30;
  const towerDy = isCiq ? 20 : -20;

  return [
    {
      id: `${prefix}-clearance-hall`,
      landmarkId: landmark.id,
      landmark,
      partName: "Customs Clearance Hall",
      polygon: createBox(lon, lat, hallDim[0], hallDim[1], 0, 0, 0),
      heightM: 28,
      color: transportRgb,
      wireframeColor: brighten(transportRgb, 1.25),
    },
    {
      id: `${prefix}-viaduct-deck`,
      landmarkId: landmark.id,
      landmark,
      partName: "Elevated Bus & Viaduct Deck",
      polygon: createBox(lon, lat, viaductDim[0], viaductDim[1], 0, viaductDy, 0),
      heightM: 16,
      color: [195, 155, 245],
      wireframeColor: brighten([195, 155, 245], 1.25),
    },
    {
      id: `${prefix}-control-tower`,
      landmarkId: landmark.id,
      landmark,
      partName: "Checkpoint Control Tower",
      polygon: createBox(lon, lat, 28, 28, towerDx, towerDy, 0),
      heightM: 45,
      color: [215, 165, 255],
      wireframeColor: [255, 230, 160],
    },
  ];
}

function buildRetailComplexMeshes(
  landmark: Landmark,
  towerHeight: number,
  towerOffset: [number, number],
): LandmarkMeshPart[] {
  const [lon, lat] = landmark.position;
  const retailRgb = KIND_RGB.retail;

  return [
    {
      id: `${landmark.id}-mall-podium`,
      landmarkId: landmark.id,
      landmark,
      partName: "Retail Mall Podium",
      polygon: createBox(lon, lat, 95, 80, 0, 0, 0),
      heightM: 35,
      color: retailRgb,
      wireframeColor: brighten(retailRgb, 1.25),
    },
    {
      id: `${landmark.id}-office-tower`,
      landmarkId: landmark.id,
      landmark,
      partName: "Office Tower",
      polygon: createBox(lon, lat, 42, 38, towerOffset[0], towerOffset[1], 0),
      heightM: towerHeight,
      color: [255, 185, 95],
      wireframeColor: brighten([255, 185, 95], 1.25),
    },
  ];
}

/** Default 3-tier architectural generator for any landmark */
function buildDefaultMultiTier(landmark: Landmark): LandmarkMeshPart[] {
  const [lon, lat, rawRoof] = landmark.position;
  const roofH = Math.max(12, rawRoof);
  const baseColor = KIND_RGB[landmark.kind] ?? [142, 198, 230];

  const podiumH = Math.max(6, Math.round(roofH * 0.25));
  const mainH = Math.max(10, Math.round(roofH * 0.85));
  const crownH = roofH;

  const podiumDim = Math.max(48, Math.min(80, Math.round(35 + roofH * 0.25)));
  const mainDim = Math.max(32, Math.min(55, Math.round(25 + roofH * 0.15)));
  const crownDim = Math.max(18, Math.min(35, Math.round(15 + roofH * 0.08)));

  return [
    {
      id: `${landmark.id}-podium`,
      landmarkId: landmark.id,
      landmark,
      partName: "Podium Footprint",
      polygon: createBox(lon, lat, podiumDim, Math.round(podiumDim * 0.85), 0, 0, 0),
      heightM: podiumH,
      color: brighten(baseColor, 0.82),
      wireframeColor: brighten(baseColor, 1.1),
    },
    {
      id: `${landmark.id}-structure`,
      landmarkId: landmark.id,
      landmark,
      partName: "Main Volume",
      polygon: createBox(lon, lat, mainDim, Math.round(mainDim * 0.85), 0, 0, 0),
      heightM: mainH,
      color: baseColor,
      wireframeColor: brighten(baseColor, 1.25),
    },
    {
      id: `${landmark.id}-crown`,
      landmarkId: landmark.id,
      landmark,
      partName: "Roof Crown",
      polygon: createRegularPolygon(lon, lat, Math.round(crownDim / 2), 8, 0, 0, 0),
      heightM: crownH,
      color: brighten(baseColor, 1.18, 15),
      wireframeColor: brighten(baseColor, 1.4, 30),
    },
  ];
}

/**
 * Builds recognizable 3D multi-part meshes for every landmark in the catalogue.
 */
export function buildLandmarkMeshes(landmarks: readonly Landmark[] = LANDMARKS): LandmarkMeshPart[] {
  const parts: LandmarkMeshPart[] = [];

  for (const landmark of landmarks) {
    switch (landmark.id) {
      case "mbs":
        parts.push(...buildMbsMeshes(landmark));
        break;
      case "larkin":
        parts.push(...buildLarkinMeshes(landmark));
        break;
      case "gardens":
        parts.push(...buildGardensMeshes(landmark));
        break;
      case "esplanade":
        parts.push(...buildEsplanadeMeshes(landmark));
        break;
      case "pinnacle":
        parts.push(...buildPinnacleMeshes(landmark));
        break;
      case "ciq":
        parts.push(...buildCheckpointMeshes(landmark, true));
        break;
      case "woodlands":
        parts.push(...buildCheckpointMeshes(landmark, false));
        break;
      case "citysquare":
        parts.push(...buildRetailComplexMeshes(landmark, 150, [20, 15]));
        break;
      case "komtar":
        parts.push(...buildRetailComplexMeshes(landmark, 100, [-15, 15]));
        break;
      default:
        parts.push(...buildDefaultMultiTier(landmark));
        break;
    }
  }

  return parts;
}

export interface LandmarkMeshLayerOptions {
  id?: string;
  landmarks?: readonly Landmark[];
  meshParts?: readonly LandmarkMeshPart[];
  focusedId?: string | null;
  hoveredId?: string | null;
  onHover?: (info: PickingInfo<LandmarkMeshPart>) => void;
  onClick?: (info: PickingInfo<LandmarkMeshPart>) => void;
}

/**
 * Creates a deck.gl PolygonLayer rendering all 3D architectural landmark meshes.
 */
export function landmarkMeshLayer(
  options: LandmarkMeshLayerOptions = {},
): PolygonLayer<LandmarkMeshPart> {
  const {
    id = "landmark-3d-meshes",
    landmarks = LANDMARKS,
    meshParts,
    focusedId = null,
    hoveredId = null,
    onHover,
    onClick,
  } = options;

  const data = meshParts ?? buildLandmarkMeshes(landmarks);

  return new PolygonLayer<LandmarkMeshPart>({
    id,
    data,
    pickable: true,
    stroked: true,
    filled: true,
    extruded: true,
    wireframe: true,
    lineWidthMinPixels: 1.5,
    autoHighlight: true,
    highlightColor: [255, 230, 128, 180],
    getPolygon: (d: LandmarkMeshPart) => d.polygon,
    getElevation: (d: LandmarkMeshPart) => d.heightM,
    getFillColor: (d: LandmarkMeshPart): [number, number, number, number] => {
      const isFocused = d.landmarkId === focusedId;
      const isHovered = d.landmarkId === hoveredId;
      if (isFocused) {
        return [
          Math.min(255, d.color[0] + 50),
          Math.min(255, d.color[1] + 50),
          Math.min(255, d.color[2] + 50),
          255,
        ];
      }
      if (isHovered) {
        return [
          Math.min(255, d.color[0] + 30),
          Math.min(255, d.color[1] + 30),
          Math.min(255, d.color[2] + 30),
          245,
        ];
      }
      return [d.color[0], d.color[1], d.color[2], 225];
    },
    getLineColor: (d: LandmarkMeshPart): [number, number, number, number] => {
      if (d.landmarkId === focusedId) {
        return [255, 230, 128, 255];
      }
      return [d.wireframeColor[0], d.wireframeColor[1], d.wireframeColor[2], 235];
    },
    material: {
      ambient: 0.65,
      diffuse: 0.7,
      shininess: 48,
      specularColor: [90, 120, 150],
    },
    updateTriggers: {
      getFillColor: [focusedId, hoveredId],
      getLineColor: [focusedId],
    },
    onHover,
    onClick,
  });
}
