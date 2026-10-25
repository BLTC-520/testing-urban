import { useEffect, useState } from "react";
import { dashboardUrl } from "../lib/dashboard";
import { href } from "../lib/router";
import "./header.css";

// Resolved once at build time; null hides the link (see lib/dashboard.ts).
const DASHBOARD_URL = dashboardUrl(import.meta.env);

const LINKS = [
  { href: href("/"), label: "Story", path: "/" },
  { href: href("/explore"), label: "Explore", path: "/explore" },
  { href: href("/methods"), label: "Methods", path: "/methods" },
  { href: href("/about"), label: "About", path: "/about" },
];

export function Header({ path, overlay = false }: { path: string; overlay?: boolean }) {
  // transparent over the hero, solid once the page scrolls under it
  const [top, setTop] = useState(true);
  useEffect(() => {
    if (!overlay) return;
    const on = () => setTop(window.scrollY < 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [overlay]);
  return (
    <header className={`site-header${overlay && top ? " overlay" : ""}`}>
      <a className="wordmark" href={href("/")} aria-label="Singapore / Johor Bahru 15-Minute City Explorer — home">
        <span className="wm-mark" aria-hidden>
          <svg viewBox="0 0 32 32" width="22" height="22">
            <path d="M3 21 C 11 17, 21 17, 29 21" fill="none" stroke="var(--jb)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="13" r="7.5" fill="none" stroke="var(--ramp-6)" strokeWidth="1.6" strokeDasharray="2 2.2" />
            <circle cx="16" cy="13" r="2.2" fill="var(--sg)" />
          </svg>
        </span>
        <span className="wm-text">
          <b>SG / JB</b> <span>15-Minute City Explorer</span>
        </span>
      </a>
      <nav aria-label="Primary">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} aria-current={path === l.path ? "page" : undefined}>
            {l.label}
          </a>
        ))}
        {DASHBOARD_URL && (
          // A separate app, so a new tab: the reader keeps their place here.
          <a
            className="nav-cta"
            href={DASHBOARD_URL}
            target="_blank"
            rel="noopener"
            aria-label="Command Centre (opens in a new tab)"
          >
            <span className="cta-long">Command Centre</span>
            <span className="cta-short">Dashboard</span> <span aria-hidden>↗</span>
          </a>
        )}
      </nav>
    </header>
  );
}
