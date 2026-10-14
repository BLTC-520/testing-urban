import { useEffect } from "react";
import { Explorer } from "./explore/Explorer";
import { useRoute } from "./lib/router";

export default function App() {
  const route = useRoute();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.path]);
  switch (route.path) {
    case "/explore":
      return <Explorer params={route.params} />;
    default:
      return <Explorer params={route.params} />;
  }
}
