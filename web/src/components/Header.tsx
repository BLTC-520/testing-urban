import "./header.css";

const LINKS = [
  { href: "#/", label: "Story", path: "/" },
  { href: "#/explore", label: "Explore", path: "/explore" },
  { href: "#/methods", label: "Methods", path: "/methods" },
];

export function Header({ path, overlay = false }: { path: string; overlay?: boolean }) {
  return (
    <header className={`site-header${overlay ? " overlay" : ""}`}>
      <a className="wordmark" href="#/" aria-label="Singapore / Johor Bahru 15-Minute City Explorer — home">
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
      </nav>
    </header>
  );
}
