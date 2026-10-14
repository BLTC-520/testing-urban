import { useEffect } from "react";
import { Explorer } from "./explore/Explorer";
import { useRoute } from "./lib/router";

export default function App() {
  const route = useRoute();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.path]);
  return <Explorer params={route.params} />;
}
