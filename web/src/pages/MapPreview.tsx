import { MapCanvas } from "../map/MapCanvas";

export function MapPreview() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <MapCanvas initialView={{ center: [103.78, 1.42], zoom: 10.4 }} layers={[]} />
    </div>
  );
}
