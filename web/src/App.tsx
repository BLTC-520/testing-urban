import { useEffect } from "react";
import { useRoute } from "./lib/router";
import { MapPreview } from "./pages/MapPreview";

export default function App() {
  const route = useRoute();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.path]);
  switch (route.path) {
    default:
      return <MapPreview />;
  }
}
