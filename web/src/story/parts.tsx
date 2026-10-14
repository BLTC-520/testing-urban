import type { ReactNode } from "react";

/** Building blocks shared by the Story chapters. */
export function Essay({ id, children, tone = "default" }: { id?: string; children: ReactNode; tone?: "default" | "deep" }) {
  return (
    <section className={`essay ${tone}`} id={id} data-scene="hold">
      <div className="essay-inner">{children}</div>
    </section>
  );
}

export function Kicker({ n, children }: { n?: string; children: ReactNode }) {
  return (
    <div className="kicker">
      {n ? <span className="kicker-n">{n}</span> : null}
      <span>{children}</span>
    </div>
  );
}
