import { lazy, Suspense, useEffect } from "react";
import { Header } from "./components/Header";
import { Explorer } from "./explore/Explorer";
import { applyPageMeta } from "./lib/pages";
import { href, interceptLinks, useRoute } from "./lib/router";
import { Story } from "./story/Story";

const Methods = lazy(() => import("./methods/Methods").then((m) => ({ default: m.Methods })));
const About = lazy(() => import("./about/About").then((m) => ({ default: m.About })));

export default function App() {
  const route = useRoute();
  useEffect(() => interceptLinks(), []);
  useEffect(() => {
    applyPageMeta(route.path);
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [route.path]);
  switch (route.path) {
    case "/":
      return <Story />;
    case "/explore":
      return <Explorer params={route.params} />;
    case "/methods":
      return (
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Methods />
        </Suspense>
      );
    case "/about":
      return (
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <About />
        </Suspense>
      );
    default:
      return <NotFound />;
  }
}

function NotFound() {
  useEffect(() => {
    document.title = "Page not found — SG / JB 15-Minute City Explorer";
  }, []);
  return (
    <div className="not-found">
      <Header path="" />
      <main>
        <h1>Nothing within walking distance here</h1>
        <p>
          This address does not exist. Try the <a href={href("/")}>Story</a>, the <a href={href("/explore")}>Explorer</a> or the{" "}
          <a href={href("/methods")}>Methods</a>.
        </p>
      </main>
    </div>
  );
}
