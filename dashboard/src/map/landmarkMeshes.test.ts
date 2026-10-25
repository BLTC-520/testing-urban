import { describe, expect, it } from "vitest";
import { LANDMARK_KINDS } from "./landmarkTypes.ts";
import { CURATED, LANDMARKS } from "./landmarks.ts";
import {
  brighten,
  buildLandmarkMeshes,
  createBox,
  createEllipsePolygon,
  createRegularPolygon,
  KIND_RGB,
  landmarkMeshLayer,
  offsetMetres,
  type LandmarkMeshPart,
} from "./landmarkMeshes.ts";

describe("landmark semantic colors (KIND_RGB)", () => {
  it("defines vivid, distinct RGB values for every landmark kind", () => {
    for (const kind of LANDMARK_KINDS) {
      const rgb = KIND_RGB[kind];
      expect(rgb).toBeDefined();
      expect(rgb).toHaveLength(3);
      for (const channel of rgb) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it("matches the exact semantic palette specifications", () => {
    expect(KIND_RGB.icon).toEqual([56, 217, 214]);
    expect(KIND_RGB.transport).toEqual([176, 128, 240]);
    expect(KIND_RGB.health).toEqual([235, 88, 124]);
    expect(KIND_RGB.education).toEqual([98, 148, 245]);
    expect(KIND_RGB.leisure).toEqual([52, 199, 116]);
    expect(KIND_RGB.retail).toEqual([240, 158, 54]);
    expect(KIND_RGB.culture).toEqual([244, 132, 95]);
    expect(KIND_RGB.civic).toEqual([142, 198, 230]);
  });
});

describe("geometry helpers", () => {
  it("offsetMetres displaces accurately and supports rotation", () => {
    const origin: [number, number] = [103.85, 1.28];
    const northOffset = offsetMetres(origin[0], origin[1], 0, 110574, 0);
    expect(northOffset[0]).toBeCloseTo(origin[0], 4);
    expect(northOffset[1]).toBeCloseTo(origin[1] + 1.0, 3);

    // 90 deg counter-clockwise rotation transforms East (dx: 100, dy: 0) into North (dx: 0, dy: 100)
    const unrotatedNorth = offsetMetres(origin[0], origin[1], 0, 100, 0);
    const rotatedEastToNorth = offsetMetres(origin[0], origin[1], 100, 0, 90);
    expect(rotatedEastToNorth[0]).toBeCloseTo(unrotatedNorth[0], 5);
    expect(rotatedEastToNorth[1]).toBeCloseTo(unrotatedNorth[1], 5);
  });

  it("createBox creates a closed 5-vertex polygon ring", () => {
    const ring = createBox(103.85, 1.28, 50, 30, 10, 5, -25);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]); // Closed loop
  });

  it("createRegularPolygon creates a closed ring with sides + 1 points", () => {
    const ring = createRegularPolygon(103.85, 1.28, 25, 8);
    expect(ring).toHaveLength(9);
    expect(ring[0]).toEqual(ring[8]);
  });

  it("createEllipsePolygon creates a closed ring with sides + 1 points", () => {
    const ring = createEllipsePolygon(103.85, 1.28, 60, 40, 16);
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[16]);
  });

  it("brighten clamps between 0 and 255", () => {
    expect(brighten([100, 100, 100], 1.5, 0)).toEqual([150, 150, 150]);
    expect(brighten([200, 200, 200], 2.0, 50)).toEqual([255, 255, 255]);
  });
});

describe("handcrafted landmark multi-part meshes", () => {
  it("builds Marina Bay Sands with 3 towers, SkyPark ship deck, Shoppes podium, and ArtScience lotus", () => {
    const mbsLandmark = CURATED.find((l) => l.id === "mbs")!;
    const parts = buildLandmarkMeshes([mbsLandmark]);

    const partNames = parts.map((p) => p.partName);
    expect(partNames).toContain("Tower 1");
    expect(partNames).toContain("Tower 2");
    expect(partNames).toContain("Tower 3");
    expect(partNames).toContain("SkyPark Ship Deck");
    expect(partNames).toContain("The Shoppes & Convention Podium");
    expect(partNames).toContain("ArtScience Museum Lotus");

    const skypark = parts.find((p) => p.partName === "SkyPark Ship Deck")!;
    expect(skypark.heightM).toBe(205);
    expect(skypark.color).toEqual([255, 209, 102]); // Iconic gold ship deck

    const tower1 = parts.find((p) => p.partName === "Tower 1")!;
    expect(tower1.heightM).toBe(195);
    expect(tower1.color).toEqual(KIND_RGB.icon);

    const lotus = parts.find((p) => p.partName === "ArtScience Museum Lotus")!;
    expect(lotus.heightM).toBe(48);

    const shoppes = parts.find((p) => p.partName === "The Shoppes & Convention Podium")!;
    expect(shoppes.heightM).toBe(32);
  });

  it("builds Larkin Sentral with concourse, bus bays, and terminal crown", () => {
    const larkin = CURATED.find((l) => l.id === "larkin")!;
    expect(larkin).toBeDefined();
    const parts = buildLandmarkMeshes([larkin]);

    const names = parts.map((p) => p.partName);
    expect(names).toContain("Main Terminal Concourse & Market Hall");
    expect(names).toContain("North Express Bus Bay Canopy");
    expect(names).toContain("East Express Bus Bay Canopy");
    expect(names).toContain("Central Terminal Tower Crown");

    const crown = parts.find((p) => p.partName === "Central Terminal Tower Crown")!;
    expect(crown.heightM).toBe(34);
    expect(crown.color).toEqual([240, 175, 75]);

    const concourse = parts.find((p) => p.partName === "Main Terminal Concourse & Market Hall")!;
    expect(concourse.heightM).toBe(24);
    expect(concourse.color).toEqual(KIND_RGB.transport);
  });

  it("builds Gardens by the Bay with Flower Dome, Cloud Forest, and 6 Supertrees", () => {
    const gardens = CURATED.find((l) => l.id === "gardens")!;
    const parts = buildLandmarkMeshes([gardens]);

    expect(parts.some((p) => p.partName === "Flower Dome")).toBe(true);
    expect(parts.some((p) => p.partName === "Cloud Forest")).toBe(true);

    const supertrees = parts.filter((p) => p.partName.includes("Supertree"));
    expect(supertrees).toHaveLength(6);
    for (const tree of supertrees) {
      expect(tree.heightM).toBeGreaterThanOrEqual(38);
      expect(tree.heightM).toBeLessThanOrEqual(50);
      expect(tree.wireframeColor).toEqual([245, 200, 70]); // Gold crown
    }
  });

  it("builds Esplanade with twin Durian Domes and waterfront podium", () => {
    const esplanade = CURATED.find((l) => l.id === "esplanade")!;
    const parts = buildLandmarkMeshes([esplanade]);

    const concert = parts.find((p) => p.partName === "Concert Hall Durian Dome");
    const theatre = parts.find((p) => p.partName === "Theatre Durian Dome");
    const podium = parts.find((p) => p.partName === "Waterfront Stage Podium");

    expect(concert?.heightM).toBe(42);
    expect(theatre?.heightM).toBe(42);
    expect(podium?.heightM).toBe(18);
  });

  it("builds Pinnacle@Duxton with 7 blocks and 50th-floor skybridge", () => {
    const pinnacle = CURATED.find((l) => l.id === "pinnacle")!;
    const parts = buildLandmarkMeshes([pinnacle]);

    const blocks = parts.filter((p) => p.partName.startsWith("Block 1"));
    expect(blocks).toHaveLength(7);
    for (const b of blocks) {
      expect(b.heightM).toBe(156);
      expect(b.color).toEqual(KIND_RGB.civic);
    }

    const skybridge = parts.find((p) => p.partName === "50th-Floor Skybridge");
    expect(skybridge).toBeDefined();
    expect(skybridge?.heightM).toBe(158);
  });

  it("builds CIQ and Woodlands with clearance hall, viaduct deck, and control tower", () => {
    const ciq = CURATED.find((l) => l.id === "ciq")!;
    const woodlands = CURATED.find((l) => l.id === "woodlands")!;

    const ciqParts = buildLandmarkMeshes([ciq]);
    expect(ciqParts.map((p) => p.partName)).toEqual([
      "Customs Clearance Hall",
      "Elevated Bus & Viaduct Deck",
      "Checkpoint Control Tower",
    ]);

    const woodlandsParts = buildLandmarkMeshes([woodlands]);
    expect(woodlandsParts.map((p) => p.partName)).toEqual([
      "Customs Clearance Hall",
      "Elevated Bus & Viaduct Deck",
      "Checkpoint Control Tower",
    ]);
  });

  it("builds retail complexes for City Square and Komtar JBCC", () => {
    const cs = CURATED.find((l) => l.id === "citysquare")!;
    const komtar = CURATED.find((l) => l.id === "komtar")!;

    const csParts = buildLandmarkMeshes([cs]);
    expect(csParts.find((p) => p.partName === "Office Tower")?.heightM).toBe(150);

    const komtarParts = buildLandmarkMeshes([komtar]);
    expect(komtarParts.find((p) => p.partName === "Office Tower")?.heightM).toBe(100);
  });
});

describe("default multi-tier architectural massing generator", () => {
  it("creates a 3-part architectural massing for every other landmark", () => {
    const hospital = CURATED.find((l) => l.id === "sgh")!;
    const parts = buildLandmarkMeshes([hospital]);

    expect(parts).toHaveLength(3);
    const [podium, main, crown] = parts;

    expect(podium.partName).toBe("Podium Footprint");
    expect(main.partName).toBe("Main Volume");
    expect(crown.partName).toBe("Roof Crown");

    expect(podium.heightM).toBeLessThan(main.heightM);
    expect(main.heightM).toBeLessThanOrEqual(crown.heightM);
    expect(crown.heightM).toBe(hospital.position[2]);
    expect(main.color).toEqual(KIND_RGB.health);
  });
});

describe("buildLandmarkMeshes on whole catalogue", () => {
  it("produces closed valid 3D polygon mesh parts for every landmark in LANDMARKS", () => {
    const allParts = buildLandmarkMeshes(LANDMARKS);
    expect(allParts.length).toBeGreaterThan(LANDMARKS.length * 2);

    for (const part of allParts) {
      expect(part.id).toBeTruthy();
      expect(part.landmarkId).toBeTruthy();
      expect(part.heightM).toBeGreaterThan(0);
      expect(part.polygon.length).toBeGreaterThanOrEqual(4);
      // Closed polygon ring check
      expect(part.polygon[0]).toEqual(part.polygon[part.polygon.length - 1]);
      expect(part.color).toHaveLength(3);
      expect(part.wireframeColor).toHaveLength(3);
    }
  });
});

describe("landmarkMeshLayer deck.gl layer", () => {
  it("instantiates a pickable, extruded, wireframed PolygonLayer", () => {
    const layer = landmarkMeshLayer();
    expect(layer.id).toBe("landmark-3d-meshes");
    expect(layer.props.pickable).toBe(true);
    expect(layer.props.extruded).toBe(true);
    expect(layer.props.wireframe).toBe(true);
    expect(layer.props.stroked).toBe(true);
    expect(layer.props.filled).toBe(true);
    expect(layer.props.autoHighlight).toBe(true);
    expect(layer.props.highlightColor).toEqual([255, 230, 128, 180]);
    expect(layer.props.lineWidthMinPixels).toBe(1.5);
  });

  it("evaluates getElevation, getPolygon, getFillColor, and getLineColor with focus/hover styles", () => {
    const testPart: LandmarkMeshPart = {
      id: "test-part",
      landmarkId: "mbs",
      landmark: CURATED.find((l) => l.id === "mbs")!,
      partName: "Test Part",
      polygon: [[103.85, 1.28], [103.86, 1.28], [103.86, 1.29], [103.85, 1.28]],
      heightM: 120,
      color: [100, 150, 200],
      wireframeColor: [120, 180, 240],
    };

    const layerDefault = landmarkMeshLayer({ meshParts: [testPart] });
    const getElev = layerDefault.props.getElevation as unknown as (d: LandmarkMeshPart) => number;
    const getPoly = layerDefault.props.getPolygon as unknown as (d: LandmarkMeshPart) => [number, number][];
    const getFill = layerDefault.props.getFillColor as unknown as (d: LandmarkMeshPart) => number[];
    const getLine = layerDefault.props.getLineColor as unknown as (d: LandmarkMeshPart) => number[];

    expect(getElev(testPart)).toBe(120);
    expect(getPoly(testPart)).toEqual(testPart.polygon);
    expect(getFill(testPart)).toEqual([100, 150, 200, 225]);
    expect(getLine(testPart)).toEqual([120, 180, 240, 235]);

    // When focused:
    const layerFocused = landmarkMeshLayer({ meshParts: [testPart], focusedId: "mbs" });
    const getFillFocused = layerFocused.props.getFillColor as unknown as (d: LandmarkMeshPart) => number[];
    const getLineFocused = layerFocused.props.getLineColor as unknown as (d: LandmarkMeshPart) => number[];
    expect(getFillFocused(testPart)).toEqual([150, 200, 250, 255]);
    expect(getLineFocused(testPart)).toEqual([255, 230, 128, 255]);

    // When hovered:
    const layerHovered = landmarkMeshLayer({ meshParts: [testPart], hoveredId: "mbs" });
    const getFillHovered = layerHovered.props.getFillColor as unknown as (d: LandmarkMeshPart) => number[];
    expect(getFillHovered(testPart)).toEqual([130, 180, 230, 245]);
  });
});
