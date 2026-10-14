import { Component, type ErrorInfo, type ReactNode } from "react";
import { href } from "../lib/router";

interface Props {
  /** what to show in place of the children once one of them has thrown */
  fallback: (error: Error) => ReactNode;
  /** told about the error, for a parent that needs to change its own view */
  onError?: (error: Error) => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a failure inside the part of the page that raised it, so the rest of
 * the page keeps working. A contained error is logged as a warning: the
 * fallback is the intended outcome, not a crash to alarm anyone about.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("Contained error:", error, info.componentStack);
    this.props.onError?.(error);
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

/** Shown when a whole page fails: says so, and offers plain links to the rest of the site. */
export function PageFallback() {
  return (
    <div className="page-fallback">
      <main>
        <p className="eyebrow">SG / JB 15-Minute City Explorer</p>
        <h1>This page could not be shown</h1>
        <p>Something went wrong while drawing it. Reloading often fixes that. You can also open another page:</p>
        <ul>
          <li>
            <a href={href("/")}>Story</a>
          </li>
          <li>
            <a href={href("/explore")}>Explorer</a>
          </li>
          <li>
            <a href={href("/methods")}>Methods</a>
          </li>
          <li>
            <a href={href("/about")}>About</a>
          </li>
          <li>
            <a href={`${import.meta.env.BASE_URL}llms.txt`}>llms.txt, a plain-text guide for AI readers</a>
          </li>
        </ul>
        <button type="button" onClick={() => window.location.reload()}>
          Reload this page
        </button>
      </main>
    </div>
  );
}
