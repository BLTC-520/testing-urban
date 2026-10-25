import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { CURATED } from "../map/landmarks.ts";
import { useFilters, type CameraSnapshot } from "./filters.ts";

const mbs = CURATED.find((l) => l.id === "mbs")!;
const nafa = CURATED.find((l) => l.id === "nafa")!;
const ciq = CURATED.find((l) => l.id === "ciq")!;

const initialCam: CameraSnapshot = {
  center: [103.82, 1.355],
  zoom: 10.3,
  pitch: 42,
  bearing: -12,
};

const midFlightCam: CameraSnapshot = {
  center: [103.8607, 1.2837],
  zoom: 16.5,
  pitch: 62,
  bearing: 168,
};

describe("landmark focus-state transitions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("enters focus mode, saves the pre-focus camera and switches 3D buildings on when an ion token exists", () => {
    const f = useFilters();
    f.select({ hex: "886520d527fffff", unit: 3, unitName: "Downtown Core" });
    expect(f.buildings).toBe(false);

    f.focusLandmark(mbs, initialCam, true);

    expect(f.isFocused).toBe(true);
    expect(f.focusedLandmark?.id).toBe("mbs");
    expect(f.selection).toBeNull();
    expect(f.buildings).toBe(true);
    expect(f.savedBuildings).toBe(false);
    expect(f.savedCamera).toEqual(initialCam);
    expect(f.rightTab).toBe("landmarks");
  });

  it("switches directly to another landmark while keeping the original pre-focus camera and layer state", () => {
    const f = useFilters();
    f.focusLandmark(mbs, initialCam, true);
    f.focusLandmark(nafa, midFlightCam, true);

    expect(f.focusedLandmark?.id).toBe("nafa");
    expect(f.savedCamera).toEqual(initialCam);
    expect(f.savedBuildings).toBe(false);
  });

  it("exits focus mode and restores the saved camera and previous 3D buildings state", () => {
    const f = useFilters();
    f.focusLandmark(mbs, initialCam, true);
    f.focusLandmark(nafa, midFlightCam, true);

    const restored = f.exitFocus();

    expect(restored).toEqual(initialCam);
    expect(f.isFocused).toBe(false);
    expect(f.focusedLandmark).toBeNull();
    expect(f.buildings).toBe(false);
    expect(f.savedCamera).toBeNull();
  });

  it("leavesfocus mode and restores state when switching city away from the focused landmark", () => {
    const f = useFilters();
    f.focusLandmark(mbs, initialCam, true);
    expect(f.city).toBe("sg");

    f.setCity("jb");

    expect(f.city).toBe("jb");
    expect(f.focusedLandmark).toBeNull();
    expect(f.buildings).toBe(false);
  });

  it("switches city automatically when focusing a landmark in the other city", () => {
    const f = useFilters();
    expect(f.city).toBe("sg");

    f.focusLandmark(ciq, initialCam, false);

    expect(f.city).toBe("jb");
    expect(f.focusedLandmark?.id).toBe("ciq");
  });
});
