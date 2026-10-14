import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

/** LaTeX rendered with KaTeX (inline by default; `block` for display equations). */
export function Tex({ children, block = false }: { children: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(children, { displayMode: block, throwOnError: false, output: "htmlAndMathml" }), [children, block]);
  const Tag = block ? "div" : "span";
  return <Tag className={block ? "tex tex-block" : "tex"} dangerouslySetInnerHTML={{ __html: html }} />;
}
