import { lazy, Suspense, useEffect } from "react";
import { Explorer } from "./explore/Explorer";
import { useRoute } from "./lib/router";
import { Story } from "./story/Story";

const Methods = lazy(() => import("./methods/Methods").then((m) => ({ default: m.Methods })));

export default function App() {
  const route = useRoute();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.path]);
  switch (route.path) {
    case "/explore":
      return <Explorer params={route.params} />;
    case "/methods":
      return (
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Methods />
        </Suspense>
      );
    default:
      return <Story />;
  }
}
